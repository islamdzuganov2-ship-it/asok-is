"""
Прикладные функции домена risk (ТЗ v13). Публикуются через фасад пакета (app.modules.risk).
Используются другими доменами (llm/reporting) как источник обоснований (grounding), без
прямого доступа к ORM-модели risk извне.
"""
from __future__ import annotations

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.incidents import triggering_characteristics
from app.modules.risk.embeddings import embed_text
from app.modules.risk.models import RiskBase
from app.modules.risk.schemas import RiskBaseOut, TriggeredRiskOut


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


async def triggered_risks(
    db: AsyncSession, *, system: str | None = None, characteristics: str | None = None,
) -> list[TriggeredRiskOut]:
    """Риск-триггеры (T-16): риски, «сработавшие» по текущему состоянию — проактивная защита от
    техсбоя. Источники: (1) частые техсбои по категориям (маппинг на характеристику ISO 25010);
    (2) явно переданные просевшие характеристики/метрики (`characteristics`, через запятую).
    Возвращает релевантные риски из базы с пояснением, ЧЕМ сработал каждый (grounding для ЛПР/LLM).

    Вынесено из router.py в сервисный слой (ТЗ v21, КП-40): нужно как переиспользуемый источник
    данных агрегатору кокпита (/reports/cockpit), не только HTTP-эндпоинту."""
    char_triggers = await triggering_characteristics(db, system=system)
    reasons: dict[str, str] = {
        char: "техсбои: " + ", ".join(f"{lbl} ({cnt})" for lbl, cnt in cats)
        for char, cats in char_triggers.items()
    }
    for c in (characteristics or "").split(","):
        name = c.strip()
        if name:
            reasons.setdefault(name, "просевшая характеристика/метрика")
    if not reasons:
        return []
    risks = await risks_for_characteristics(db, list(reasons.keys()), limit=20)
    # Причина ищется по нормализованному имени (ё/е): ключи reasons — из маппинга (с ё),
    # а characteristic риска может быть без ё.
    norm_reasons = {_norm_char(k): v for k, v in reasons.items()}
    return [
        TriggeredRiskOut(
            **RiskBaseOut.model_validate(r).model_dump(),
            triggered_by=norm_reasons.get(_norm_char(r.characteristic), "связанный риск"),
        )
        for r in risks
    ]


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
