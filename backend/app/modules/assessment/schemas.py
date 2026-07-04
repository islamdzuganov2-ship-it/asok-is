"""Pydantic-схемы домена assessment (периоды, значения, суждения), ТЗ v13."""
from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class PeriodCreate(BaseModel):
    system_id: UUID
    period: str = Field(..., min_length=3, max_length=20)


class PeriodUpdate(BaseModel):
    period: str | None = Field(None, min_length=3, max_length=20)
    status: str | None = Field(None, min_length=1, max_length=20)


class PeriodOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    system_id: UUID
    period: str
    status: str
    created_at: datetime
    updated_at: datetime


class ValueCreate(BaseModel):
    period_id: UUID
    metric_id: int
    val_a: float | None = Field(None, ge=0)
    val_b: float | None = Field(None, ge=0)
    expert_comment: str | None = Field(None, max_length=2000)
    artifact_links: list[str] | None = None
    data_source: str = Field("MANUAL", max_length=20)


class ValueUpdate(BaseModel):
    val_a: float | None = Field(None, ge=0)
    val_b: float | None = Field(None, ge=0)
    expert_comment: str | None = Field(None, max_length=2000)
    artifact_links: list[str] | None = None


class ValueOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    period_id: UUID
    metric_id: int
    val_a: float | None
    val_b: float | None
    calculated_x: float | None
    quality_level: str | None
    expert_comment: str | None
    artifact_links: list[str] | None
    data_source: str
    created_at: datetime
    updated_at: datetime


class EditableMetricOut(BaseModel):
    id: str
    name: str
    characteristic: str = ""
    subcharacteristic: str = ""
    metric_id: int | None = None
    description: str
    val_a: float | None = None
    val_b: float | None = None
    expert_comment: str | None = ""
    unmeasurable: bool = False
    calculatedX: float | None = None
    qualityLevel: str | None = None


class EditableMetricIn(BaseModel):
    id: str
    val_a: float | None = Field(None, ge=0)
    val_b: float | None = Field(None, ge=0)
    expert_comment: str | None = Field("", max_length=2000)
    # «Невозможно измерить»: при True комментарий обязателен (валидируется на эндпоинте).
    unmeasurable: bool = False


class ValueAddIn(BaseModel):
    """Добавление/заполнение оценки для одной пары (характеристика, подхарактеристика)."""
    characteristic: str = Field(..., min_length=1, max_length=255)
    subcharacteristic: str = Field(..., min_length=1, max_length=255)
    formula_type: str | None = Field(None, pattern="^(DIRECT|INVERSE)$")
    val_a: float | None = Field(None, ge=0)
    val_b: float | None = Field(None, ge=0)
    expert_comment: str | None = Field(None, max_length=2000)
    unmeasurable: bool = False
    # Подтверждающий артефакт (ссылка/файл/№ тикета) для обоснования оценки подхарактеристики.
    artifact_links: str | None = Field(None, max_length=1000)


class JudgmentIn(BaseModel):
    """Профессиональное суждение по подхарактеристике (задача менеджера по качеству)."""
    characteristic: str = Field(..., min_length=1, max_length=255)
    subcharacteristic: str = Field(..., min_length=1, max_length=255)
    judgment_text: str = Field(..., min_length=1, max_length=4000)


class JudgmentOut(BaseModel):
    id: str
    characteristic: str
    subcharacteristic: str
    judgment_text: str
    author: str | None = None


class JudgmentsStatusOut(BaseModel):
    period_id: str
    filled: int
    total: int
    complete: bool
    items: list[JudgmentOut]


class PeriodSummaryOut(BaseModel):
    """Сводка по периоду оценки: сколько подхарактеристик заполнено и полна ли оценка."""
    id: UUID
    system_id: UUID
    system_name: str
    period: str
    status: str
    filled: int
    total: int
    complete: bool


class CalculatedMetricOut(BaseModel):
    id: str
    name: str
    calculatedX: float
    systemLevel: str
    adjustedLevel: Optional[str] = None
    expertComment: Optional[str] = None


class ExpertJudgmentCreate(BaseModel):
    metricId: str
    calculatedLevel: str
    adjustedLevel: Optional[str] = None
    justificationText: str = Field(..., min_length=10, max_length=5000)
    linkedRiskTask: Optional[str] = Field(None, max_length=500)
