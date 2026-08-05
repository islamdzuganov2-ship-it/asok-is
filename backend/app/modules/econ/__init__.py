"""
Домен econ (BL-007) — экономический фундамент риск-экономического контура.

Справочники: бизнес-процессы и стоимость минуты простоя (E9), ставки сопровождения L1/L2/L3 (E8),
финпараметры контура. Публичный фасад: модели — в реестре import_models(); движки C_ТС/ALE/ROSI
садятся поверх этих данных и доступны соседним доменам через этот фасад (по мере готовности).
"""
from app.modules.econ.economics import (
    DecisionInput,
    annual_loss_expectancy,
    cost_incident,
    decide,
    k_performance_degradation,
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
)

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
    # Сервис/транспорт
    "router",
    "seed_econ_defaults",
    "resolve_support_rate",
    "compute_incident_cost",
    "config_value",
]
