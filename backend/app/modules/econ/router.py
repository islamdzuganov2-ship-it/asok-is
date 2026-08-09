"""
REST API домена econ (BL-007) — /api/v1/econ.

Справочники риск-экономического контура + финпараметры. RBAC:
- чтение — всем аутентифицированным (аналитик читает ставки/стоимости при вводе);
- справочники (БП, связи, C_мин, ставки) ведёт риск-менеджер / менеджер по качеству;
- финпараметры (ставка дисконта, пороги, риск-аппетит, матрица акцепта) — риск-менеджер / админ (SoD).
Доменные исключения маппятся на HTTP обработчиком в main.py.
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.database import get_db
from app.modules.econ import service
from app.modules.econ.dashboard_service import cost_dashboard
from app.modules.econ.schemas import (
    BpCostIn,
    BpCostOut,
    BusinessProcessCreate,
    BusinessProcessOut,
    BusinessProcessUpdate,
    CostDashboardOut,
    EconConfigItem,
    EconConfigValueIn,
    SupportRateIn,
    SupportRateOut,
    SupportRateUpdate,
    SystemBpCreate,
    SystemBpOut,
)
from app.modules.iam import get_current_user, require_permission

router = APIRouter()

REF_ROLES = ("RISK_MANAGER", "QUALITY_MANAGER", "ADMIN")   # ведут справочники контура
CONFIG_ROLES = ("RISK_MANAGER", "ADMIN")                   # правят финпараметры (риск-аппетит/пороги)


# ═══════════════════════ Дашборд стоимости (§5, RE-16) ═══════════════════════

@router.get("/dashboard", response_model=CostDashboardOut)
async def get_cost_dashboard(
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(get_current_user),
) -> CostDashboardOut:
    """Агрегаты для CTO/CEO: портфельный ALE, тепловая карта, топ рисков, воронка, деградация."""
    return await cost_dashboard(db)


# ═══════════════════════ Финпараметры ═══════════════════════

@router.get("/config", response_model=list[EconConfigItem])
async def get_config(
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(get_current_user),
) -> list:
    return await service.get_config(db)


@router.put("/config/{key}", response_model=EconConfigItem)
async def set_config(
    key: str,
    payload: EconConfigValueIn,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("econ.config.edit")),
):
    return await service.set_config(db, key, payload.value, payload.description)


# ═══════════════════════ Бизнес-процессы (E9) ═══════════════════════

@router.get("/business-processes", response_model=list[BusinessProcessOut])
async def list_business_processes(
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(get_current_user),
) -> list:
    return await service.list_business_processes(db)


@router.post("/business-processes", response_model=BusinessProcessOut, status_code=201)
async def create_business_process(
    payload: BusinessProcessCreate,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("econ.ref.edit")),
):
    return await service.create_business_process(db, payload)


@router.patch("/business-processes/{bp_id}", response_model=BusinessProcessOut)
async def update_business_process(
    bp_id: uuid.UUID,
    payload: BusinessProcessUpdate,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("econ.ref.edit")),
):
    bp = await service.get_bp_or_404(db, bp_id)
    return await service.update_business_process(db, bp, payload)


@router.get("/business-processes/{bp_id}/cost", response_model=BpCostOut | None)
async def get_bp_cost(
    bp_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(get_current_user),
):
    return await service.get_bp_cost(db, bp_id)


@router.put("/business-processes/{bp_id}/cost", response_model=BpCostOut)
async def upsert_bp_cost(
    bp_id: uuid.UUID,
    payload: BpCostIn,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("econ.ref.edit")),
):
    return await service.upsert_bp_cost(db, bp_id, payload)


# ── Связь ИС↔БП ──

@router.get("/systems/{system_id}/business-processes", response_model=list[SystemBpOut])
async def list_system_bps(
    system_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(get_current_user),
) -> list:
    return await service.list_system_bps(db, system_id)


@router.post("/systems/{system_id}/business-processes", response_model=SystemBpOut, status_code=201)
async def link_system_bp(
    system_id: uuid.UUID,
    payload: SystemBpCreate,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("econ.ref.edit")),
):
    return await service.link_system_bp(db, system_id, payload)


# ═══════════════════════ Ставки сопровождения (E8) ═══════════════════════

@router.get("/rates", response_model=list[SupportRateOut])
async def list_rates(
    system_id: uuid.UUID | None = None,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(get_current_user),
) -> list:
    return await service.list_rates(db, system_id=system_id)


@router.post("/rates", response_model=SupportRateOut, status_code=201)
async def create_rate(
    payload: SupportRateIn,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("econ.ref.edit")),
):
    return await service.create_rate(db, payload)


@router.patch("/rates/{rate_id}", response_model=SupportRateOut)
async def update_rate(
    rate_id: uuid.UUID,
    payload: SupportRateUpdate,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("econ.ref.edit")),
):
    rate = await service.get_rate_or_404(db, rate_id)
    return await service.update_rate(db, rate, payload)
