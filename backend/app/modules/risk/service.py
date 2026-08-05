"""
Прикладные функции домена risk (ТЗ v13). Публикуются через фасад пакета (app.modules.risk).
Используются другими доменами (llm/reporting) как источник обоснований (grounding), без
прямого доступа к ORM-модели risk извне.
"""
from __future__ import annotations

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.risk.embeddings import embed_text
from app.modules.risk.models import RiskBase


async def search_risks(db: AsyncSession, q: str, limit: int = 5) -> list[RiskBase]:
    """Простой лексический поиск активных рисков для LLM-grounding (текст/ключевые слова).

    Оставлен НЕИЗМЕННЫМ: это стабильный fallback и текущий путь grounding LLM. Семантический
    поиск (T-20) — отдельная функция semantic_search_risks, чтобы не менять хрупкий контур."""
    like = f"%{q.lower()}%"
    stmt = (
        select(RiskBase)
        .where(RiskBase.status == "active")
        .where(or_(
            RiskBase.title.ilike(like),
            RiskBase.characteristic.ilike(like),
            RiskBase.category.ilike(like),
            RiskBase.keywords.ilike(like),
            RiskBase.description.ilike(like),
        ))
        .limit(limit)
    )
    return list((await db.execute(stmt)).scalars().all())


def _norm_char(s: str | None) -> str:
    """Нормализация имени характеристики для сопоставления: ё→е, регистр, пробелы.
    Устраняет рассинхрон источников (напр. риск «Надежность» vs метрика «Надёжность»)."""
    return (s or "").lower().replace("ё", "е").strip()


async def risks_for_characteristics(
    db: AsyncSession, characteristics: list[str], limit: int = 8
) -> list[RiskBase]:
    """Активные риски по набору характеристик — обоснование мер/заключений (reporting/llm).

    Сопоставление устойчиво к ё/е и регистру: имена характеристик в базе рисков и в оценке
    исторически расходятся (Надёжность/Надежность), иначе grounding молча теряет релевантные риски.
    """
    if not characteristics:
        return []
    wanted = {_norm_char(c) for c in characteristics}
    rows = list((await db.execute(
        select(RiskBase).where(RiskBase.status == "active")
    )).scalars().all())
    matched = [r for r in rows if _norm_char(r.characteristic) in wanted]
    return matched[:limit]


# ─── T-20: семантический поиск (pgvector) ───

def _risk_text(risk: RiskBase) -> str:
    """Каноничный текст карточки риска для эмбеддинга — смысловое ядро (те же поля, что в
    ILIKE-поиске, плюс последствия/меры/триггеры). Симметрично тому, как эмбеддится запрос."""
    parts = [risk.title, risk.characteristic, risk.subcharacteristic, risk.category,
             risk.keywords, risk.description, risk.consequence, risk.mitigation, risk.triggers]
    return " ".join(p for p in parts if p)


def embed_risk(risk: RiskBase) -> list[float]:
    """Вектор карточки риска — сохраняется в risk_base.embedding при создании/правке/импорте."""
    return embed_text(_risk_text(risk))


async def semantic_search_risks(db: AsyncSession, q: str, limit: int = 5) -> list[RiskBase]:
    """Семантический поиск активных рисков по косинусной близости эмбеддингов (T-20).

    Честный откат на лексический ILIKE-поиск (search_risks), если: (1) запрос дал нулевой вектор
    (пустой/пунктуация), либо (2) ни у одной активной записи ещё нет эмбеддинга (фича развёрнута,
    но бэкфилл не прогнан) — чтобы поиск не «пустел» на переходном состоянии.
    """
    qvec = embed_text(q)
    if not any(qvec):
        return await search_risks(db, q, limit)

    has_emb = (await db.execute(
        select(RiskBase.id).where(RiskBase.status == "active")
        .where(RiskBase.embedding.isnot(None)).limit(1)
    )).first()
    if has_emb is None:
        return await search_risks(db, q, limit)

    stmt = (
        select(RiskBase)
        .where(RiskBase.status == "active")
        .where(RiskBase.embedding.isnot(None))
        .order_by(RiskBase.embedding.cosine_distance(qvec))
        .limit(limit)
    )
    return list((await db.execute(stmt)).scalars().all())


async def reembed_all(db: AsyncSession, only_missing: bool = False) -> int:
    """Бэкфилл эмбеддингов базы рисков. only_missing=True — только строки без вектора (после
    первого разворачивания фичи); иначе пересчитать все (после смены провайдера эмбеддингов)."""
    stmt = select(RiskBase)
    if only_missing:
        stmt = stmt.where(RiskBase.embedding.is_(None))
    rows = list((await db.execute(stmt)).scalars().all())
    for risk in rows:
        risk.embedding = embed_risk(risk)
    await db.commit()
    return len(rows)
