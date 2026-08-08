"""
REST API домена nonconformity (BL-007, RE-14) — /api/v1/nonconformities.

Жизненный цикл замыкания контура. RBAC (SoD §3.3):
- ведение/оценка/назначение меры/исполнение — менеджер по качеству / риск-менеджер;
- решение (вердикт, принятие риска с подписью) — риск-менеджер / топ-менеджмент;
- верификация — ТОЛЬКО аудитор (независимая роль);
- чтение и воронка замкнутости — всем аутентифицированным.
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.database import get_db
from app.modules.iam import get_current_user, require_permission
from app.modules.nonconformity import service
from app.modules.nonconformity.schemas import (
    AssignMeasureIn,
    ClosureFunnelOut,
    DecideIn,
    EvaluateIn,
    ExecuteIn,
    NonconformityCreate,
    NonconformityOut,
    VerifyIn,
)

router = APIRouter()

CONTOUR_ROLES = ("QUALITY_MANAGER", "RISK_MANAGER", "ADMIN")   # ведение/оценка/исполнение
DECIDE_ROLES = ("RISK_MANAGER", "CTO", "CEO", "ADMIN")         # решение/принятие риска
VERIFY_ROLES = ("AUDITOR", "ADMIN")                            # независимая верификация (SoD)


@router.get("", response_model=list[NonconformityOut])
async def list_nonconformities(
    system: str | None = None,
    status: str | None = None,
    include_demo: bool = True,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(get_current_user),
) -> list:
    return await service.list_nonconformities(db, system=system, status=status, include_demo=include_demo)


@router.get("/funnel", response_model=ClosureFunnelOut)
async def closure_funnel(
    include_demo: bool = True,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(get_current_user),
) -> ClosureFunnelOut:
    return await service.closure_funnel(db, include_demo=include_demo)


@router.post("", response_model=NonconformityOut, status_code=201)
async def create_nonconformity(
    payload: NonconformityCreate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_permission("nonconformity.edit")),
):
    return await service.create(db, payload, user.get("username"))


@router.get("/{nc_id}", response_model=NonconformityOut)
async def get_nonconformity(
    nc_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(get_current_user),
):
    return await service.get_or_404(db, nc_id)


@router.post("/{nc_id}/evaluate", response_model=NonconformityOut)
async def evaluate(
    nc_id: uuid.UUID,
    payload: EvaluateIn,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_permission("nonconformity.edit")),
):
    nc = await service.get_or_404(db, nc_id)
    return await service.evaluate(db, nc, payload.evaluated_ale, user.get("username"))


@router.post("/{nc_id}/decide", response_model=NonconformityOut)
async def decide(
    nc_id: uuid.UUID,
    payload: DecideIn,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_permission("nonconformity.decide")),
):
    nc = await service.get_or_404(db, nc_id)
    return await service.decide(db, nc, payload, user.get("username"))


@router.post("/{nc_id}/assign-measure", response_model=NonconformityOut)
async def assign_measure(
    nc_id: uuid.UUID,
    payload: AssignMeasureIn,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_permission("nonconformity.edit")),
):
    nc = await service.get_or_404(db, nc_id)
    return await service.assign_measure(db, nc, payload.proposal_id, user.get("username"))


@router.post("/{nc_id}/start", response_model=NonconformityOut)
async def start(
    nc_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_permission("nonconformity.edit")),
):
    nc = await service.get_or_404(db, nc_id)
    return await service.start(db, nc, user.get("username"))


@router.post("/{nc_id}/execute", response_model=NonconformityOut)
async def execute(
    nc_id: uuid.UUID,
    payload: ExecuteIn | None = None,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_permission("nonconformity.edit")),
):
    nc = await service.get_or_404(db, nc_id)
    return await service.execute(db, nc, user.get("username"), payload.comment if payload else None)


@router.post("/{nc_id}/verify", response_model=NonconformityOut)
async def verify(
    nc_id: uuid.UUID,
    payload: VerifyIn | None = None,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_permission("risk.verify")),
):
    nc = await service.get_or_404(db, nc_id)
    return await service.verify(db, nc, user.get("username"), payload.delta_score_confirmed if payload else None)
