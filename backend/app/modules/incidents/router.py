"""
REST API домена incidents (T-21) — /api/v1/incidents.

Аналитика технических сбоев (надёжность ИС). RBAC: ввод/правку/закрытие ведёт менеджер по качеству
(QM/ADMIN), чтение и аналитика — всем аутентифицированным (топ-менеджмент смотрит по флагу
`execIncidents` на фронте). Доменные исключения маппятся на HTTP обработчиком в main.py.
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.database import get_db
from app.modules.iam import get_current_user, require_role
from app.modules.incidents import service
from app.modules.incidents.schemas import (
    IncidentAnalyticsOut,
    ResolveIn,
    TechIncidentCreate,
    TechIncidentOut,
    TechIncidentUpdate,
)

router = APIRouter()

MANAGER_ROLES = ("QUALITY_MANAGER", "ADMIN")  # ведут реестр сбоев (менеджер по качеству)


@router.get("", response_model=list[TechIncidentOut])
async def list_incidents(
    system: str | None = None,
    category: str | None = None,
    severity: str | None = None,
    status: str | None = None,  # open | resolved
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(get_current_user),
) -> list:
    return await service.list_incidents(db, system=system, category=category, severity=severity, status=status)


@router.get("/analytics", response_model=IncidentAnalyticsOut)
async def incident_analytics(
    system: str | None = None,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(get_current_user),
) -> IncidentAnalyticsOut:
    return await service.analytics(db, system=system)


@router.post("", response_model=TechIncidentOut, status_code=201)
async def create_incident(
    payload: TechIncidentCreate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_role(*MANAGER_ROLES)),
):
    return await service.create(db, payload, user.get("username") or "—")


@router.patch("/{iid}", response_model=TechIncidentOut)
async def update_incident(
    iid: uuid.UUID,
    payload: TechIncidentUpdate,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_role(*MANAGER_ROLES)),
):
    inc = await service.get_or_404(db, iid)
    return await service.update(db, inc, payload)


@router.post("/{iid}/resolve", response_model=TechIncidentOut)
async def resolve_incident(
    iid: uuid.UUID,
    payload: ResolveIn | None = None,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_role(*MANAGER_ROLES)),
):
    inc = await service.get_or_404(db, iid)
    return await service.resolve(db, inc, payload.resolved_at if payload else None)
