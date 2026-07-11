"""
Логика домена incidents (T-21): CRUD техсбоев + аналитика надёжности.

Аналитика — самостоятельный анализатор (не трогает расчётный движок качества): распределение по
первопричинам, MTTR (среднее время восстановления закрытых), топ нестабильных ИС, доля сбоев,
привнесённых релизом. Валидация категории/критичности — здесь (не покрыта схемой перечислением).
"""
from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.incidents.models import (
    CATEGORIES,
    CATEGORY_RELEASE,
    SEVERITIES,
    TechIncident,
)
from app.modules.incidents.schemas import (
    CategoryStat,
    IncidentAnalyticsOut,
    SystemStat,
    TechIncidentCreate,
    TechIncidentUpdate,
)
from app.shared.exceptions import NotFoundError, ValidationError


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _validate(category: str | None, severity: str | None) -> None:
    if category is not None and category not in CATEGORIES:
        raise ValidationError(f"Недопустимая категория сбоя: {category}")
    if severity is not None and severity not in SEVERITIES:
        raise ValidationError(f"Недопустимая критичность: {severity}")


def _mttr_hours(inc: TechIncident) -> float | None:
    if inc.resolved_at is None or inc.occurred_at is None:
        return None
    return round((inc.resolved_at - inc.occurred_at).total_seconds() / 3600, 1)


async def list_incidents(
    db: AsyncSession, *, system: str | None = None, category: str | None = None,
    severity: str | None = None, status: str | None = None,
) -> list[TechIncident]:
    stmt = select(TechIncident)
    if system:
        stmt = stmt.where(TechIncident.system_name == system)
    if category:
        stmt = stmt.where(TechIncident.category == category)
    if severity:
        stmt = stmt.where(TechIncident.severity == severity)
    if status == "open":
        stmt = stmt.where(TechIncident.resolved_at.is_(None))
    elif status == "resolved":
        stmt = stmt.where(TechIncident.resolved_at.is_not(None))
    stmt = stmt.order_by(TechIncident.occurred_at.desc())
    return list((await db.execute(stmt)).scalars().all())


async def get_or_404(db: AsyncSession, iid: uuid.UUID) -> TechIncident:
    inc = await db.get(TechIncident, iid)
    if inc is None:
        raise NotFoundError("Технический сбой не найден")
    return inc


async def create(db: AsyncSession, data: TechIncidentCreate, username: str) -> TechIncident:
    _validate(data.category, data.severity)
    inc = TechIncident(**data.model_dump(exclude_none=False), created_by=username)
    db.add(inc)
    await db.commit()
    await db.refresh(inc)
    return inc


async def update(db: AsyncSession, inc: TechIncident, data: TechIncidentUpdate) -> TechIncident:
    patch = data.model_dump(exclude_unset=True)
    _validate(patch.get("category"), patch.get("severity"))
    for field, value in patch.items():
        setattr(inc, field, value)
    await db.commit()
    await db.refresh(inc)
    return inc


async def resolve(db: AsyncSession, inc: TechIncident, resolved_at: datetime | None) -> TechIncident:
    inc.resolved_at = resolved_at or _now()
    await db.commit()
    await db.refresh(inc)
    return inc


async def analytics(db: AsyncSession, *, system: str | None = None) -> IncidentAnalyticsOut:
    rows = await list_incidents(db, system=system)
    total = len(rows)
    open_rows = [r for r in rows if r.resolved_at is None]
    resolved_rows = [r for r in rows if r.resolved_at is not None]

    all_mttr = [m for m in (_mttr_hours(r) for r in resolved_rows) if m is not None]
    avg_mttr = round(sum(all_mttr) / len(all_mttr), 1) if all_mttr else None

    # Разбивка по категориям (все известные категории — стабильный порядок, включая нулевые).
    cat_rows: dict[str, list[TechIncident]] = defaultdict(list)
    for r in rows:
        cat_rows[r.category].append(r)
    by_category: list[CategoryStat] = []
    for cat in CATEGORIES:
        items = cat_rows.get(cat, [])
        if not items:
            continue
        mttrs = [m for m in (_mttr_hours(r) for r in items if r.resolved_at is not None) if m is not None]
        by_category.append(CategoryStat(
            category=cat,
            count=len(items),
            share=round(len(items) / total * 100, 1) if total else 0.0,
            open_count=sum(1 for r in items if r.resolved_at is None),
            avg_mttr_hours=round(sum(mttrs) / len(mttrs), 1) if mttrs else None,
        ))
    by_category.sort(key=lambda c: c.count, reverse=True)

    # Топ нестабильных ИС по числу сбоев.
    sys_rows: dict[str, list[TechIncident]] = defaultdict(list)
    for r in rows:
        sys_rows[r.system_name].append(r)
    top_systems = sorted(
        (SystemStat(
            system_name=name,
            count=len(items),
            open_count=sum(1 for r in items if r.resolved_at is None),
        ) for name, items in sys_rows.items()),
        key=lambda s: s.count, reverse=True,
    )[:10]

    release_count = len(cat_rows.get(CATEGORY_RELEASE, []))
    return IncidentAnalyticsOut(
        total=total,
        open_count=len(open_rows),
        resolved_count=len(resolved_rows),
        avg_mttr_hours=avg_mttr,
        release_induced_share=round(release_count / total * 100, 1) if total else 0.0,
        by_category=by_category,
        top_systems=top_systems,
    )
