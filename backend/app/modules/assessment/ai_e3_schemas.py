"""DTO этапа E3 контура СИИ (ГОСТ Р 59898-2021; BL-001): тестовые наборы и выбросы, паритет
сред, экспертная группа и согласованность, сравнение нескольких СИИ, справочник узлов модели."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class DatasetIn(BaseModel):
    name: str = Field(min_length=1)
    purpose: str = "TEST"
    records: int | None = None
    source: str | None = None
    collected_from: str | None = None
    representativeness: str | None = None
    class_balance: dict[str, float] | None = None
    outlier_method: str | None = None
    outlier_k: float | None = None
    outlier_feature: str | None = None
    outliers_count: int | None = None
    outliers_share: float | None = None
    outlier_handling: str | None = None
    notes: str | None = None


class DatasetOut(DatasetIn):
    id: str
    period_id: str
    updated_at: datetime | None = None


class OutlierCheckIn(BaseModel):
    """Значения числового признака набора — выбросы считаются сервером тем же методом, что
    записывается в метаданные набора (воспроизводимость, разд. 9)."""
    feature: str = Field(min_length=1)
    values: list[float]
    method: str = "IQR"
    k: float | None = None
    handling: str | None = None


class ParityRowIn(BaseModel):
    factor: str
    test_env: str | None = None
    prod_env: str | None = None
    status: str
    justification: str | None = None


class ParityRowOut(ParityRowIn):
    label: str


class ParityOut(BaseModel):
    rows: list[ParityRowOut]
    factors: list[dict]
    summary: dict


class ExpertScoreIn(BaseModel):
    characteristic: str
    subcharacteristic: str
    score: float = Field(ge=0, le=100)
    comment: str | None = None


class ConsensusOut(BaseModel):
    experts: list[dict]
    kendall: dict
    objects: list[dict]


class ApplyConsensusOut(BaseModel):
    applied: int
    kendall_w: float | None
    consistent: bool


class TestConditionsOut(BaseModel):
    """Условия испытаний для отчёта соответствия и завершения оценки."""
    datasets: int
    datasets_without_outlier_criterion: list[str]
    parity: dict
    expert_group: dict | None
    ready: bool
    gaps: list[str]


class QmNodeOut(BaseModel):
    model_config = ConfigDict(protected_namespaces=())   # поле model_kind — термин ТЗ, не служебное

    id: str
    model_kind: str
    level: str
    parent_id: str | None
    code: str
    name_ru: str
    metric_kind: str | None
    is_ai_specific: bool
    sort: int
