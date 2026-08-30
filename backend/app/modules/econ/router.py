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
from app.shared.filters import parse_str_list, parse_uuid_list
from app.modules.econ import service
from app.modules.econ.acceptance_queue_service import acceptance_queue
from app.modules.econ.dashboard_service import cost_dashboard
from app.modules.econ.manager_metrics_service import ManagerMetricsOut, manager_metrics
from app.modules.econ.measure_catalog import CatalogEntryOut, as_out, entries_for
from app.modules.econ.portfolio_trend_service import portfolio_trend
from app.modules.econ.weights_service import WeightsResult, compute_subchar_weights
from app.modules.econ.schemas import (
    AcceptanceQueueOut,
    BenchmarkComparisonOut,
    BpCostIn,
    BpCostOut,
    BusinessProcessCreate,
    BusinessProcessOut,
    BusinessProcessUpdate,
    CostDashboardOut,
    EconConfigItem,
    EconConfigValueIn,
    EnterpriseProfileIn,
    EnterpriseProfileOut,
    MarketBenchmarkCreate,
    MarketBenchmarkOut,
    PortfolioTrendOut,
    SupportRateIn,
    SupportRateOut,
    SupportRateUpdate,
    SystemBpCreate,
    SystemBpOut,
)
from app.modules.iam import get_current_user, require_permission, resolve_user_id

router = APIRouter()

REF_ROLES = ("RISK_MANAGER", "QUALITY_MANAGER", "ADMIN")   # ведут справочники контура
CONFIG_ROLES = ("RISK_MANAGER", "ADMIN")                   # правят финпараметры (риск-аппетит/пороги)


# ═══════════════════════ Дашборд стоимости (§5, RE-16) ═══════════════════════

@router.get("/dashboard", response_model=CostDashboardOut)
async def get_cost_dashboard(
    system_id: str | None = None,
    criticality: str | None = None,
    characteristic: str | None = None,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(get_current_user),
) -> CostDashboardOut:
    """Агрегаты для CTO/CEO: портфельный ALE, тепловая карта, топ рисков, воронка, деградация.
    Сквозной разрез (ТЗ v21 §10.4): без параметров поведение не меняется (КП-ПР-7). system_id/
    criticality — списком через запятую (формат `qs()` на фронте)."""
    return await cost_dashboard(
        db, system_id=parse_uuid_list(system_id), criticality=parse_str_list(criticality),
        characteristic=characteristic,
    )


# ═══════════════════════ Кокпит CEO/CTO (ТЗ v21, КП-11/12) ═══════════════════════

@router.get("/acceptance-queue", response_model=AcceptanceQueueOut)
async def get_acceptance_queue(
    signer: str | None = None,
    system_id: str | None = None,
    criticality: str | None = None,
    characteristic: str | None = None,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(get_current_user),
) -> AcceptanceQueueOut:
    """Очередь решений по матрице акцепта (плитка CEO «Что требует моей подписи?», КП-23.2)."""
    return await acceptance_queue(
        db, signer=signer, system_id=parse_uuid_list(system_id), criticality=parse_str_list(criticality),
        characteristic=characteristic,
    )


@router.get("/portfolio-trend", response_model=PortfolioTrendOut)
async def get_portfolio_trend(
    metric: str = "score",
    periods: int = 6,
    system_id: str | None = None,
    criticality: str | None = None,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(get_current_user),
) -> PortfolioTrendOut:
    """Динамика портфельных величин между периодами (плитки CEO 5.1 и CTO «Что просело», КП-24/КП-31)."""
    return await portfolio_trend(
        db, metric=metric, periods=periods,
        system_id=parse_uuid_list(system_id), criticality=parse_str_list(criticality),
    )


# ═══════════════ Эффективность руководителей (задача 12, §7.1) — ДИАГНОСТИКА ═══════════════

@router.get("/manager-metrics", response_model=ManagerMetricsOut)
async def get_manager_metrics(
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(get_current_user),
) -> ManagerMetricsOut:
    """По владельцам: нагрузка/просрочка/выполнено, ΔALE под управлением, доли решений (без мотивации)."""
    return await manager_metrics(db)


# ═══════════ Веса подхарактеристик (задача 13, RE-15, §4.3) — СОВЕТЧИК, Score не трогаем ═══════════

@router.get("/weights", response_model=WeightsResult)
async def get_subchar_weights(
    criticality: str = "BUSINESS_CRITICAL",
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(get_current_user),
) -> WeightsResult:
    """Гибрид-веса: α·профиль(класс ИС) + (1−α)·фактика(доля в ALE), α=max(α_min, N₀/(N₀+N)).
    Отдельный советчик — интегральный Score НЕ пересчитывается (решение заказчика)."""
    return await compute_subchar_weights(db, criticality=criticality)


# ═══════════ Каталог «риск → подхарактеристика → мера» (задача 7, §4.2) ═══════════

@router.get("/measure-catalog", response_model=list[CatalogEntryOut])
async def get_measure_catalog(
    characteristic: str | None = None,
    subcharacteristic: str | None = None,
    _: dict = Depends(get_current_user),
) -> list[CatalogEntryOut]:
    """Типовые связки риск↔подхарактеристика↔мера (устраняющая/компенсирующая). Методологическая
    константа: помогает аналитику при разборе несоответствия. Score/данные не меняет."""
    return as_out(entries_for(characteristic, subcharacteristic))


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


# ═══════════════════════ Профиль предприятия (ТЗ v19 УК-21, п.8) ═══════════════════════
# Одна запись-синглтон — параметр подстановки для бенчмарков (п.9-10), не справочник организаций.

@router.get("/enterprise-profile", response_model=EnterpriseProfileOut)
async def get_enterprise_profile(
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(get_current_user),
):
    return await service.get_enterprise_profile(db)


@router.put("/enterprise-profile", response_model=EnterpriseProfileOut)
async def update_enterprise_profile(
    payload: EnterpriseProfileIn,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_permission("econ.config.edit")),
):
    # resolve_user_id: под DEMO_AUTH_BYPASS current_user["id"] синтетический и не существует
    # в users — тихо пишем NULL вместо падения на FK (см. iam/identity.py).
    updated_by = await resolve_user_id(db, current_user.get("id"))
    return await service.update_enterprise_profile(db, payload, updated_by=updated_by)


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


# ═══════════════════════ Рыночные бенчмарки (ТЗ v19 п.9-10, В-30а) ═══════════════════════
# Структура без числового наполнения — таблица пуста, пока источники не согласованы заказчиком.

@router.get("/benchmarks", response_model=list[MarketBenchmarkOut])
async def list_benchmarks(
    kind: str | None = None,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(get_current_user),
) -> list:
    return await service.list_benchmarks(db, kind=kind)


@router.post("/benchmarks", response_model=MarketBenchmarkOut, status_code=201)
async def create_benchmark(
    payload: MarketBenchmarkCreate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_permission("econ.ref.edit")),
):
    uid = await resolve_user_id(db, user.get("id"))
    return await service.create_benchmark(db, payload, uid)


@router.get("/business-processes/{bp_id}/benchmark", response_model=BenchmarkComparisonOut)
async def compare_bp_benchmark(
    bp_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(get_current_user),
):
    return await service.compare_business_process(db, bp_id)


@router.get("/rates/{rate_id}/benchmark", response_model=BenchmarkComparisonOut)
async def compare_rate_benchmark(
    rate_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(get_current_user),
):
    return await service.compare_support_rate(db, rate_id)
