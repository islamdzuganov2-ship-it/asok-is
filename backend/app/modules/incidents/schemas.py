"""
Pydantic-схемы домена incidents (T-21). camelCase-алиасы — как в governance, чтобы фронт получал
привычный формат. Поле-подпись `createdBy` на входе не принимается (ставится из токена).
"""
from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class _CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)


class TechIncidentOut(_CamelModel):
    id: uuid.UUID
    system_id: uuid.UUID | None = None
    system_name: str
    category: str
    severity: str
    title: str
    description: str | None = None
    root_cause: str | None = None
    release_ref: str | None = None
    admission_cause: str | None = None
    responsible_unit: str | None = None
    preventive_measures: str | None = None
    category_custom: str | None = None
    linked_measure_id: uuid.UUID | None = None
    occurred_at: datetime
    resolved_at: datetime | None = None
    source: str
    created_by: str | None = None
    created_at: datetime | None = None
    # RE-07: стоимость единичной реализации (C_ТС) — считается движком econ, кэшируется на записи.
    cost_total: float | None = None
    # RE-05/06: тип события — нужен карточке, чтобы показать деградацию и её пересчёт в простой.
    incident_type: str = "DOWNTIME"
    counts_as_downtime: bool | None = None
    external_id: str | None = None
    parent_incident_id: uuid.UUID | None = None


class TechIncidentEconomicsIn(_CamelModel):
    """Экономика сбоя — ручной ввод аналитика (RE-05, задача 16). Все поля необязательны: PUT
    принимает частичную правку, незаданные поля не трогаются."""
    incident_type: str | None = None             # DOWNTIME | DEGRADATION
    degradation_type: str | None = None          # FUNCTIONAL | PERFORMANCE | THROUGHPUT
    degradation_inputs: dict | None = None       # входы расчёта K по типу (RE-06)
    downtime_minutes: float | None = None
    k_impact: float | None = None                # K вручную, если входов для расчёта нет
    t_reaction_min: float | None = None
    t_resolution_min: float | None = None
    t_target_min: float | None = None
    root_cause_fixed_at: datetime | None = None
    labor_l1_hours: float | None = None
    labor_l2_hours: float | None = None
    labor_l3_hours: float | None = None
    labor_vendor_lines: list[str] | None = None  # линии, закрытые вендором (RE-03)
    vendor_involved: bool | None = None


class TechIncidentEconomicsOut(_CamelModel):
    id: uuid.UUID
    system_name: str
    occurred_at: datetime
    incident_type: str
    degradation_type: str | None = None
    degradation_inputs: dict | None = None
    downtime_minutes: float | None = None
    k_impact: float | None = None
    counts_as_downtime: bool | None = None
    t_reaction_min: float | None = None
    t_resolution_min: float | None = None
    t_target_min: float | None = None
    root_cause_fixed_at: datetime | None = None
    labor_l1_hours: float | None = None
    labor_l2_hours: float | None = None
    labor_l3_hours: float | None = None
    labor_vendor_lines: list[str] | None = None
    labor_source: str | None = None
    vendor_involved: bool = False
    cost_total: float | None = None
    cost_breakdown: dict | None = None


class TechIncidentCreate(_CamelModel):
    system_name: str
    system_id: uuid.UUID | None = None
    category: str
    severity: str = "medium"
    title: str
    description: str | None = None
    root_cause: str | None = None
    release_ref: str | None = None
    admission_cause: str | None = None
    responsible_unit: str | None = None
    preventive_measures: str | None = None
    category_custom: str | None = None
    linked_measure_id: uuid.UUID | None = None
    occurred_at: datetime
    resolved_at: datetime | None = None
    source: str = "manual"


class TechIncidentUpdate(_CamelModel):
    category: str | None = None
    severity: str | None = None
    title: str | None = None
    description: str | None = None
    root_cause: str | None = None
    release_ref: str | None = None
    admission_cause: str | None = None
    responsible_unit: str | None = None
    preventive_measures: str | None = None
    category_custom: str | None = None
    linked_measure_id: uuid.UUID | None = None
    occurred_at: datetime | None = None
    resolved_at: datetime | None = None


class ResolveIn(_CamelModel):
    resolved_at: datetime | None = None  # по умолчанию — «сейчас»


# ─── Справочник первопричин (T-37) ───
class IncidentCategoryOption(_CamelModel):
    code: str
    label: str


class IncidentCategoriesOut(_CamelModel):
    base: list[IncidentCategoryOption]   # базовые коды первопричин + русские метки
    custom: list[str]                    # ранее введённые пользовательские первопричины (category=OTHER)


# ─── Импорт техсбоев из внешних источников (T-43) ───
class IncidentImportRow(_CamelModel):
    """Одна строка загрузки (нестандартизированная): значения — как в файле, нормализуются сервисом.
    Даты — строки (парсятся на сервере: ДД.ММ.ГГГГ[ ЧЧ:ММ] или ISO)."""
    system_name: str | None = None
    title: str | None = None
    occurred_at: str | None = None
    resolved_at: str | None = None
    category: str | None = None
    severity: str | None = None
    root_cause: str | None = None
    admission_cause: str | None = None
    responsible_unit: str | None = None
    preventive_measures: str | None = None
    release_ref: str | None = None


class IncidentImportResult(_CamelModel):
    created: int
    skipped: int
    errors: list[str]


# ─── Аналитика ───
class CategoryStat(_CamelModel):
    category: str
    count: int
    share: float               # доля от всех сбоев, %
    open_count: int
    avg_mttr_hours: float | None = None  # среднее время восстановления (закрытых), часы


class SystemStat(_CamelModel):
    system_name: str
    count: int
    open_count: int


class TtrStats(_CamelModel):
    """Тайминги устранения (ДЕФ-31, БТ-272). Все значения — средние по выборке, в минутах.

    Поля в модели сбоя были заведены ещё при RE-05, но наружу не отдавались — на дашборде
    аналитики сбоев виджета TTR не было вовсе, хотя заказчик просил «прикрутить к аналитике
    ТС время, затрачиваемое на исправление и устранение».
    """
    avg_reaction_min: float | None = None       # T реакции: от регистрации до начала работ
    avg_resolution_min: float | None = None     # T устранения: до восстановления сервиса
    avg_target_min: float | None = None         # T целевого решения
    # Разрыв «сервис поднят ↔ первопричина устранена» — метрика зрелости процесса:
    # большой разрыв означает, что чинят симптом, а не причину.
    avg_root_cause_lag_hours: float | None = None
    root_cause_fixed_count: int = 0
    measured_count: int = 0                     # по скольким сбоям есть тайминги


class IncidentAnalyticsOut(_CamelModel):
    total: int
    open_count: int
    resolved_count: int
    avg_mttr_hours: float | None = None
    ttr: TtrStats = TtrStats()
    release_induced_share: float           # доля сбоев категории RELEASE, %
    by_category: list[CategoryStat]
    top_systems: list[SystemStat]
    # ТЗ v21 (КП-30, кокпит CTO): «насколько мы надёжны» — простая доступность за окно
    # наблюдения (от первого сбоя выборки до сейчас), не строгий SLA-расчёт по договору.
    # None при нуле сбоев — честно «не считается», не фиктивные 100%.
    window_hours: float | None = None
    mtbf_hours: float | None = None        # окно / число сбоев — среднее время между отказами
    availability_pct: float | None = None  # 100 × (1 − Σ простоя / окно)


# ─── BL-007, задел фазы I (RE-23…RE-27): загрузка выгрузки ITSM и калибровки ───
class ItsmGroupMappingIn(_CamelModel):
    group_name: str
    system_id: uuid.UUID
    note: str | None = None


class ItsmGroupMappingOut(_CamelModel):
    id: uuid.UUID
    group_name: str
    system_id: uuid.UUID
    note: str | None = None


class SystemAliasIn(_CamelModel):
    alias: str
    system_id: uuid.UUID


class SystemAliasOut(_CamelModel):
    id: uuid.UUID
    alias: str
    system_id: uuid.UUID


class LaborCalibrationIn(_CamelModel):
    """RE-24: тикеты с известными трудозатратами — (время на линиях, ч; факт, ч)."""
    samples: list[tuple[float, float]]
    apply: bool = False


class ApmCalibrationIn(_CamelModel):
    """RE-27: сопоставленные сбои — (ITSM открыт, ITSM закрыт, APM начало, APM конец, APM-деградация)."""
    pairs: list[tuple[str, str | None, str, str | None, bool]]
    apply: bool = False
