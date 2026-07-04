"""
REST API домена risk — сквозная база рисков (ТЗ v13).

CRUD + поиск (используется LLM как источник обоснований) + импорт из risk_matrices.
Чтение доступно всем аутентифицированным; запись — QUALITY_MANAGER/ADMIN
(в DEMO_MODE deps возвращает ADMIN, поэтому работает без логина).
"""
from __future__ import annotations

import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.database import get_db
from app.modules.iam import get_current_user, require_role
from app.modules.reporting import RiskMatrix  # кросс-доменное чтение через фасад reporting
from app.modules.risk import service
from app.modules.risk.models import RiskBase
from app.modules.risk.schemas import RiskBaseCreate, RiskBaseOut, RiskBaseUpdate

router = APIRouter()


@router.get("", response_model=list[RiskBaseOut])
async def list_risks(
    category: str | None = None,
    characteristic: str | None = None,
    severity: str | None = None,
    status: str = "active",
    q: str | None = None,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(get_current_user),
) -> list[RiskBase]:
    stmt = select(RiskBase)
    if status != "all":
        stmt = stmt.where(RiskBase.status == status)
    if category:
        stmt = stmt.where(RiskBase.category == category)
    if characteristic:
        stmt = stmt.where(RiskBase.characteristic == characteristic)
    if severity:
        stmt = stmt.where(RiskBase.severity == severity)
    if q:
        like = f"%{q.lower()}%"
        stmt = stmt.where(or_(
            RiskBase.title.ilike(like),
            RiskBase.description.ilike(like),
            RiskBase.keywords.ilike(like),
            RiskBase.code.ilike(like),
        ))
    stmt = stmt.order_by(RiskBase.created_at.desc())
    return list((await db.execute(stmt)).scalars().all())


@router.get("/search", response_model=list[RiskBaseOut])
async def search_risks(
    q: str = Query(..., min_length=2),
    limit: int = 5,
    db: AsyncSession = Depends(get_db),
) -> list[RiskBase]:
    """Семантически простой поиск для LLM-grounding (по тексту/ключевым словам)."""
    return await service.search_risks(db, q, limit)


@router.post("", response_model=RiskBaseOut, status_code=201)
async def create_risk(
    payload: RiskBaseCreate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_role("QUALITY_MANAGER", "ADMIN")),
) -> RiskBase:
    exists = (await db.execute(
        select(RiskBase).where(RiskBase.code == payload.code)
    )).scalar_one_or_none()
    if exists:
        raise HTTPException(status_code=409, detail=f"Код риска уже существует: {payload.code}")
    risk = RiskBase(**payload.model_dump(), created_by=user.get("username"))
    db.add(risk)
    await db.commit()
    await db.refresh(risk)
    return risk


@router.patch("/{risk_id}", response_model=RiskBaseOut)
async def update_risk(
    risk_id: uuid.UUID,
    payload: RiskBaseUpdate,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_role("QUALITY_MANAGER", "ADMIN")),
) -> RiskBase:
    risk = await db.get(RiskBase, risk_id)
    if risk is None:
        raise HTTPException(status_code=404, detail="Риск не найден")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(risk, field, value)
    await db.commit()
    await db.refresh(risk)
    return risk


@router.post("/{risk_id}/archive", response_model=RiskBaseOut)
async def archive_risk(
    risk_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_role("QUALITY_MANAGER", "ADMIN")),
) -> RiskBase:
    risk = await db.get(RiskBase, risk_id)
    if risk is None:
        raise HTTPException(status_code=404, detail="Риск не найден")
    risk.status = "archived"
    await db.commit()
    await db.refresh(risk)
    return risk


@router.post("/import/{period_id}", response_model=dict)
async def import_from_period(
    period_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_role("QUALITY_MANAGER", "ADMIN")),
) -> dict:
    """Перенос рисков периода (risk_matrices) в накопительную базу. Дубли по коду пропускаются."""
    rows = list((await db.execute(
        select(RiskMatrix).where(RiskMatrix.period_id == period_id)
    )).scalars().all())
    existing_codes = set((await db.execute(select(RiskBase.code))).scalars().all())
    imported = 0
    today = date.today().strftime("%Y%m%d")
    for r in rows:
        code = f"R-IMP-{today}-{r.id}"
        if code in existing_codes:
            continue
        db.add(RiskBase(
            code=code,
            title=(r.risk_description or "Риск")[:120],
            category=r.characteristic or "общее",
            characteristic=r.characteristic,
            subcharacteristic=r.subcharacteristic,
            description=r.risk_description,
            consequence=r.risk_consequence,
            mitigation=r.mitigation_measures,
            source="excel",
            created_by=user.get("username"),
        ))
        existing_codes.add(code)
        imported += 1
    await db.commit()
    return {"imported": imported, "skipped": len(rows) - imported}
