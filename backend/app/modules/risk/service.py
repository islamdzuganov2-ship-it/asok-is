"""
Прикладные функции домена risk (ТЗ v13). Публикуются через фасад пакета (app.modules.risk).
Используются другими доменами (llm/reporting) как источник обоснований (grounding), без
прямого доступа к ORM-модели risk извне.
"""
from __future__ import annotations

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.risk.models import RiskBase


async def search_risks(db: AsyncSession, q: str, limit: int = 5) -> list[RiskBase]:
    """Простой семантический поиск активных рисков для LLM-grounding (текст/ключевые слова)."""
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
