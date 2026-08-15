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
