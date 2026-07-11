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
    occurred_at: datetime | None = None
    resolved_at: datetime | None = None


class ResolveIn(_CamelModel):
    resolved_at: datetime | None = None  # по умолчанию — «сейчас»


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


class IncidentAnalyticsOut(_CamelModel):
    total: int
    open_count: int
    resolved_count: int
    avg_mttr_hours: float | None = None
    release_induced_share: float           # доля сбоев категории RELEASE, %
    by_category: list[CategoryStat]
    top_systems: list[SystemStat]
