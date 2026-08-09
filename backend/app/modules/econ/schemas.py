"""
Pydantic-схемы домена econ (BL-007). camelCase-алиасы — как в incidents/governance (единый контракт
с фронтом). Справочники: бизнес-процессы, связь ИС↔БП, стоимость минуты простоя, ставки L1/L2/L3,
финпараметры контура.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class _CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)


# ── Бизнес-процесс (E9) ──
class BusinessProcessOut(_CamelModel):
    id: uuid.UUID
    code: str
    name: str
    kind: str
    owner: str | None = None
    description: str | None = None
    is_active: bool
    created_at: datetime | None = None


class BusinessProcessCreate(_CamelModel):
    code: str
    name: str
    kind: str = "BACKOFFICE"
    owner: str | None = None
    description: str | None = None


class BusinessProcessUpdate(_CamelModel):
    name: str | None = None
    kind: str | None = None
    owner: str | None = None
    description: str | None = None
    is_active: bool | None = None


# ── Связь ИС↔БП ──
class SystemBpCreate(_CamelModel):
    business_process_id: uuid.UUID
    share: float = 1.0
    default_k_impact: float | None = None


class SystemBpOut(_CamelModel):
    id: uuid.UUID
    system_id: uuid.UUID
    business_process_id: uuid.UUID
    share: float
    default_k_impact: float | None = None


# ── Стоимость минуты простоя БП (E9, C_мин) ──
class BpCostIn(_CamelModel):
    method: str = "RESOURCE"
    params: dict | None = None
    time_profile: dict | None = None
    cost_per_min_base: float | None = None
    currency: str = "RUB"
    note: str | None = None


class BpCostOut(_CamelModel):
    id: uuid.UUID
    business_process_id: uuid.UUID
    method: str
    params: dict | None = None
    time_profile: dict | None = None
    cost_per_min_base: float | None = None
    currency: str
    note: str | None = None


# ── Ставка сопровождения (E8) ──
class SupportRateIn(_CamelModel):
    system_id: uuid.UUID | None = None
    line: str
    executor_type: str = "INTERNAL"
    vendor: str | None = None
    mode: str | None = None
    rate_per_hour: float
    k_evening: float = 1.5
    k_weekend: float = 2.0
    package_hours: float | None = None
    overlimit_rate: float | None = None
    billing_quantum_min: int = 60


class SupportRateUpdate(_CamelModel):
    line: str | None = None
    executor_type: str | None = None
    vendor: str | None = None
    mode: str | None = None
    rate_per_hour: float | None = None
    k_evening: float | None = None
    k_weekend: float | None = None
    package_hours: float | None = None
    overlimit_rate: float | None = None
    billing_quantum_min: int | None = None
    is_active: bool | None = None


class SupportRateOut(_CamelModel):
    id: uuid.UUID
    system_id: uuid.UUID | None = None
    line: str
    executor_type: str
    vendor: str | None = None
    mode: str | None = None
    rate_per_hour: float
    k_evening: float
    k_weekend: float
    package_hours: float | None = None
    overlimit_rate: float | None = None
    billing_quantum_min: int
    is_active: bool


# ── Финпараметры контура ──
class EconConfigItem(_CamelModel):
    key: str
    value: object | None = None
    description: str | None = None


class EconConfigValueIn(_CamelModel):
    value: object | None = None
    description: str | None = None


# ── Дашборд стоимости (§5, RE-16) ──
class TopRiskOut(_CamelModel):
    code: str
    title: str
    owner: str | None = None
    system: str | None = None
    ale_avg: float
    regulatory: bool


class SystemAleOut(_CamelModel):
    system: str
    ale: float


class HeatCellOut(_CamelModel):
    system: str
    subcharacteristic: str
    ale: float


class VerdictBreakdownOut(_CamelModel):
    eliminate: int
    compensate: int
    accept: int


class CostDashboardOut(_CamelModel):
    portfolio_ale: float            # «одна цифра для CEO» — суммарный ALE активных рисков
    risks_count: int
    degradation_total: float        # накопленная деградация (C_ТС сбоев-деградаций)
    nonconformities_total: int
    verified: int
    closure_rate: float             # % замкнутости контура
    blocking_count: int             # незакрытые критические (блокирующие) несоответствия
    verdict: VerdictBreakdownOut    # устранено / компенсировано / принято
    top_risks: list[TopRiskOut]
    by_system: list[SystemAleOut]
    heatmap: list[HeatCellOut]      # ИС × подхарактеристика → ALE
