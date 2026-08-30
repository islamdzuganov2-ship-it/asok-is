"""
Pydantic-схемы домена econ (BL-007). camelCase-алиасы — как в incidents/governance (единый контракт
с фронтом). Справочники: бизнес-процессы, связь ИС↔БП, стоимость минуты простоя, ставки L1/L2/L3,
финпараметры контура.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field
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


# ── Профиль предприятия (ТЗ v19 УК-21, п.8, Р-4) — одна запись, параметр подстановки для п.9-10 ──
class EnterpriseProfileOut(_CamelModel):
    id: uuid.UUID
    name: str | None = None
    size_class: str | None = None      # MICRO/SMALL/MEDIUM/LARGE (209-ФЗ, В-28)
    revenue_annual: float | None = None
    headcount: int | None = None
    industry: str | None = None
    region: str | None = None
    note: str | None = None
    updated_by: uuid.UUID | None = None
    updated_at: datetime | None = None


class EnterpriseProfileIn(_CamelModel):
    name: str | None = None
    size_class: str | None = None
    revenue_annual: float | None = None
    headcount: int | None = None
    industry: str | None = None
    region: str | None = None
    note: str | None = None


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


# ── Рыночные бенчмарки (ТЗ v19 п.9-10, В-30а) — структура без числового наполнения ──
class MarketBenchmarkOut(_CamelModel):
    id: uuid.UUID
    kind: str
    dimension: str
    company_size_class: str | None = None
    value: float
    unit: str
    source: str
    observed_on: date
    note: str | None = None
    created_by: uuid.UUID | None = None
    created_at: datetime | None = None


class MarketBenchmarkCreate(_CamelModel):
    kind: str
    dimension: str
    company_size_class: str | None = None
    value: float
    unit: str
    # ОБЯЗАТЕЛЬНЫ (не Optional): без источника и даты запись не заводится — см. docstring
    # econ/models.py MarketBenchmark. min_length=1 — пустая строка не проходит там же, где None.
    source: str = Field(min_length=1)
    observed_on: date
    note: str | None = None


class BenchmarkComparisonOut(_CamelModel):
    """Сравнение своей цифры с рыночным ориентиром. benchmark=None — честное «нет данных»
    (В-30а не решён), а не 0 и не подставленное среднее «на глаз»."""
    own_value: float | None
    own_unit: str
    benchmark: MarketBenchmarkOut | None = None
    delta_pct: float | None = None   # (own - benchmark) / benchmark × 100, None если сравнивать не с чем
    note: str


# ═══════════════════════ ТЗ v21 (КП-11): очередь по матрице акцепта — кокпит CEO ═══════════════════════

class AcceptanceQueueItemOut(_CamelModel):
    kind: str                       # пока только 'NONCONFORMITY' (§15 В-КП-5 — состав уточняется)
    id: uuid.UUID
    title: str
    system_name: str | None = None
    criticality: str | None = None
    ale: float
    signer: str | None = None       # подписант по acceptance_matrix; None — матрица не покрывает сумму
    waiting_days: int
    sla_days: int
    overdue: bool
    vetoes: list[str] = Field(default_factory=list)   # 'regulatory' | 'catastrophe'


class AcceptanceQueueSignerStatOut(_CamelModel):
    signer: str
    count: int
    total_ale: float
    overdue: int


class AcceptanceMatrixEntryOut(_CamelModel):
    max_ale: float | None
    signer: str


class AcceptanceQueueOut(_CamelModel):
    items: list[AcceptanceQueueItemOut]
    by_signer: list[AcceptanceQueueSignerStatOut]
    matrix_applied: list[AcceptanceMatrixEntryOut]


# ═══════════════════════ ТЗ v21 (КП-12): динамика портфельных величин ═══════════════════════

class TrendPointOut(_CamelModel):
    period: str
    value: float


class PortfolioTrendOut(_CamelModel):
    metric: str
    points: list[TrendPointOut]
    delta_absolute: float | None = None
    delta_relative: float | None = None
    anomaly: bool = False
    # §7.3 честной пустоты: заполнено, когда history пуста — не «0 без объяснения».
    empty_reason: str | None = None
