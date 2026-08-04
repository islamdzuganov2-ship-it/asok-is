"""
Домен econ (BL-007) — экономический фундамент риск-экономического контура.

Справочники: бизнес-процессы и стоимость минуты простоя (E9), ставки сопровождения L1/L2/L3 (E8),
финпараметры контура. Публичный фасад: модели — в реестре import_models(); движки C_ТС/ALE/ROSI
садятся поверх этих данных и доступны соседним доменам через этот фасад (по мере готовности).
"""
from app.modules.econ.models import (
    BusinessProcess,
    BusinessProcessCost,
    EconConfig,
    SupportRate,
    SystemBusinessProcess,
)

__all__ = [
    "BusinessProcess",
    "SystemBusinessProcess",
    "BusinessProcessCost",
    "SupportRate",
    "EconConfig",
]
