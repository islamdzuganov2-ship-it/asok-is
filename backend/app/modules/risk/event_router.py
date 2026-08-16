"""
REST API рискового события (BL-007, RE-08/09) — /api/v1/risk-events.

Числовой контур риска (ARO/ALE), отдельно от /risks (база знаний). RBAC: реестр рисков ведёт
владелец риска (RISK_MANAGER) / админ; чтение — всем аутентифицированным (§6.1: риск-менеджер видит
весь портфель, но НЕ меняет Score — это в контуре оценки).
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.database import get_db
from app.modules.iam import get_current_user, require_permission
from app.modules.risk import event_service as service
from app.modules.risk.event_schemas import (
    AleResultOut,
    HeatmapCellDetailOut,
    IncidentLinkIn,
    IncidentLinkOut,
    MeasureLinkIn,
    MeasureLinkOut,
    RiskEventCreate,
    RiskEventOut,
    RiskEventUpdate,
    SubcharLinkIn,
    SubcharLinkOut,
)

router = APIRouter()

RISK_ROLES = ("RISK_MANAGER", "ADMIN")  # владелец риска ведёт реестр (SoD §6.1)


@router.get("", response_model=list[RiskEventOut])
async def list_events(
    status: str = "active",
    system_id: uuid.UUID | None = None,
    category: str | None = None,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(get_current_user),
) -> list:
    return await service.list_events(db, status=status, system_id=system_id, category=category)


@router.post("", response_model=RiskEventOut, status_code=201)
async def create_event(
    payload: RiskEventCreate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_permission("risk.register.edit")),
):
    return await service.create_event(db, payload, user.get("username"))


# ТЗ v19 п.4: связь ячейки теплокарты (ИС × характеристика) с рисками/мерами/деньгами. Путь
# ДО /{event_id} — иначе FastAPI попытается разобрать «by-cell» как UUID события (порядок
# регистрации маршрутов имеет значение для литеральных путей против path-параметров).
@router.get("/by-cell", response_model=HeatmapCellDetailOut)
async def get_cell_detail(
    system_name: str,
    characteristic: str,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(get_current_user),
):
    return await service.cell_detail(db, system_name, characteristic)


@router.get("/{event_id}", response_model=RiskEventOut)
async def get_event(
    event_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(get_current_user),
):
    return await service.get_or_404(db, event_id)


@router.patch("/{event_id}", response_model=RiskEventOut)
async def update_event(
    event_id: uuid.UUID,
    payload: RiskEventUpdate,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("risk.register.edit")),
):
    ev = await service.get_or_404(db, event_id)
    return await service.update_event(db, ev, payload)


@router.post("/{event_id}/archive", response_model=RiskEventOut)
async def archive_event(
    event_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("risk.register.edit")),
):
    ev = await service.get_or_404(db, event_id)
    return await service.archive_event(db, ev)


# ── Связи ──

@router.post("/{event_id}/subchars", response_model=SubcharLinkOut, status_code=201)
async def link_subchar(
    event_id: uuid.UUID,
    payload: SubcharLinkIn,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("risk.register.edit")),
):
    return await service.link_subchar(db, event_id, payload)


@router.post("/{event_id}/incidents", response_model=IncidentLinkOut, status_code=201)
async def link_incident(
    event_id: uuid.UUID,
    payload: IncidentLinkIn,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("risk.register.edit")),
):
    return await service.link_incident(db, event_id, payload.incident_id)


@router.post("/{event_id}/measures", response_model=MeasureLinkOut, status_code=201)
async def link_measure(
    event_id: uuid.UUID,
    payload: MeasureLinkIn,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("risk.register.edit")),
):
    return await service.link_measure(db, event_id, payload)


# ── Пересчёт ALE (RE-09) ──

@router.post("/{event_id}/recompute-ale", response_model=AleResultOut)
async def recompute_ale(
    event_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("risk.register.edit")),
):
    ev = await service.get_or_404(db, event_id)
    return await service.recompute_ale(db, ev)
