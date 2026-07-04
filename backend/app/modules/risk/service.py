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


async def risks_for_characteristics(
    db: AsyncSession, characteristics: list[str], limit: int = 8
) -> list[RiskBase]:
    """Активные риски по набору характеристик — обоснование мер/заключений (reporting/llm)."""
    if not characteristics:
        return []
    stmt = (
        select(RiskBase)
        .where(RiskBase.status == "active")
        .where(RiskBase.characteristic.in_(characteristics))
        .limit(limit)
    )
    return list((await db.execute(stmt)).scalars().all())
