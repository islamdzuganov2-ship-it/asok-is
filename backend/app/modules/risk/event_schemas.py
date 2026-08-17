"""
Pydantic-схемы рискового события (BL-007, RE-08/09) — числовой контур ARO/ALE.

Отдельно от risk_base (качественная база для LLM). camelCase-алиасы — единый контракт с фронтом.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class _CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)


class RiskEventCreate(_CamelModel):
    code: str
    title: str
    description: str | None = None
    category: str | None = None
    owner: str | None = None
    system_id: uuid.UUID | None = None
    risk_base_id: uuid.UUID | None = None
    aro: float | None = None
    aro_is_expert: bool = False
    sle_expert: float | None = None
    risk_appetite: float | None = None
    regulatory: bool = False


class RiskEventUpdate(_CamelModel):
    title: str | None = None
    description: str | None = None
    category: str | None = None
    owner: str | None = None
    system_id: uuid.UUID | None = None
    risk_base_id: uuid.UUID | None = None
    aro: float | None = None
    aro_is_expert: bool | None = None
    sle_expert: float | None = None
    risk_appetite: float | None = None
    regulatory: bool | None = None
    status: str | None = None


class RiskEventOut(_CamelModel):
    id: uuid.UUID
    code: str
    title: str
    description: str | None = None
    category: str | None = None
    owner: str | None = None
    system_id: uuid.UUID | None = None
    risk_base_id: uuid.UUID | None = None
    aro: float | None = None
    aro_is_expert: bool
    sle_expert: float | None = None
    ale_avg: float | None = None
    ale_p90: float | None = None
    max_sle: float | None = None
    risk_appetite: float | None = None
    regulatory: bool
    status: str
    created_by: str | None = None
    created_at: datetime | None = None


# ── Связи (M:N) ──
class SubcharLinkIn(_CamelModel):
    characteristic: str
    subcharacteristic: str


class IncidentLinkIn(_CamelModel):
    incident_id: uuid.UUID


class MeasureLinkIn(_CamelModel):
    proposal_id: uuid.UUID
    ale_reduction_share: float | None = None


class SubcharLinkOut(_CamelModel):
    id: uuid.UUID
    risk_event_id: uuid.UUID
    characteristic: str
    subcharacteristic: str


class IncidentLinkOut(_CamelModel):
    id: uuid.UUID
    risk_event_id: uuid.UUID
    incident_id: uuid.UUID


class MeasureLinkOut(_CamelModel):
    id: uuid.UUID
    risk_event_id: uuid.UUID
    proposal_id: uuid.UUID
    ale_reduction_share: float | None = None


class AleResultOut(_CamelModel):
    """Результат пересчёта годовой стоимости риска (RE-09)."""
    risk_event_id: uuid.UUID
    aro: float | None = None
    incidents_counted: int
    incidents_costed: int
    ale_avg: float | None = None
    ale_p90: float | None = None
    max_sle: float | None = None


# ── ТЗ v19 п.4: связь теплокарты (ИС × характеристика) с рисками, мерами и деньгами ──
class HeatmapCellMeasureOut(_CamelModel):
    proposal_id: uuid.UUID
    title: str
    status: str
    ale_reduction_share: float | None = None
    rosi: float | None = None
    verdict: str | None = None


class HeatmapCellRiskOut(_CamelModel):
    id: uuid.UUID
    code: str
    title: str
    ale_avg: float | None = None
    ale_p90: float | None = None
    status: str
    subcharacteristics: list[str]
    measures: list[HeatmapCellMeasureOut]


class HeatmapCellDetailOut(_CamelModel):
    system_name: str
    characteristic: str
    total_ale: float
    risks: list[HeatmapCellRiskOut]


# УК-11: денежный слой всей теплокарты за один запрос — та же агрегация, что в HeatmapCellDetailOut,
# но по всем ячейкам (ИС × характеристика) сразу, иначе фронту пришлось бы дёргать /by-cell
# N×M раз, чтобы перекрасить весь грид под режим «деньги».
class HeatmapMoneyCellOut(_CamelModel):
    system_name: str
    characteristic: str
    total_ale: float          # деньги под риском (Σ ALE активных рисков ячейки, без дублей)
    total_delta_ale: float    # ΔALE, снимаемый привязанными мерами (Σ ale_avg × Σ ale_reduction_share)
    coverage_pct: float       # доля ALE рисков, у которых есть хотя бы одна привязанная мера
