"""
Домен econ (BL-007) — экономический фундамент риск-экономического контура.

Справочники: бизнес-процессы и стоимость минуты простоя (E9), ставки сопровождения L1/L2/L3 (E8),
финпараметры контура. Публичный фасад: модели — в реестре import_models(); движки C_ТС/ALE/ROSI
садятся поверх этих данных и доступны соседним доменам через этот фасад (по мере готовности).
"""
from app.modules.econ.economics import (
    DecisionInput,
    MeasureEffectTimeline,
    QuarterEffectPoint,
    annual_loss_expectancy,
    cost_incident,
    decide,
    k_performance_degradation,
    measure_ale_risk,
    measure_effect_timeline,
    price_of_inaction_compensating,
    price_of_inaction_eliminating,
    requires_escalation,
    rosi,
)
from app.modules.econ.models import (
    BusinessProcess,
    BusinessProcessCost,
    EconConfig,
    SupportRate,
    SystemBusinessProcess,
)
from app.modules.econ.router import router
from app.modules.econ.service import (
    compute_incident_cost,
    config_value,
    resolve_support_rate,
    seed_econ_defaults,
    seed_market_benchmarks,
)
from app.modules.econ.acceptance_queue_service import acceptance_queue
from app.modules.econ.dashboard_service import cost_dashboard
from app.modules.econ.manager_metrics_service import ManagerMetricsOut, manager_metrics
from app.modules.econ.portfolio_trend_service import portfolio_trend
from app.modules.econ.schemas import AcceptanceQueueOut, CostDashboardOut, PortfolioTrendOut

__all__ = [
    # Справочники (данные)
    "BusinessProcess",
    "SystemBusinessProcess",
    "BusinessProcessCost",
    "SupportRate",
    "EconConfig",
    # Движок (чистые функции)
    "cost_incident",
    "annual_loss_expectancy",
    "rosi",
    "decide",
    "DecisionInput",
    "k_performance_degradation",
    "measure_ale_risk",
    "requires_escalation",
    "price_of_inaction_eliminating",
    "price_of_inaction_compensating",
    "measure_effect_timeline",
    "MeasureEffectTimeline",
    "QuarterEffectPoint",
    # Сервис/транспорт
    "router",
    "seed_econ_defaults",
    "seed_market_benchmarks",
    "resolve_support_rate",
    "compute_incident_cost",
    "config_value",
    # Кокпит (ТЗ v21)
    "cost_dashboard",
    "CostDashboardOut",
    "acceptance_queue",
    "AcceptanceQueueOut",
    "portfolio_trend",
    "PortfolioTrendOut",
    "manager_metrics",
    "ManagerMetricsOut",
]
