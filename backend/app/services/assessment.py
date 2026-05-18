import uuid
from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict, field_validator

class AssessmentPeriodCreate(BaseModel):
    system_id: uuid.UUID
    period: str = Field(..., pattern=r"^Q[1-4]-\d{4}$")

class AssessmentPeriodRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    system_id: uuid.UUID
    period: str
    status: str
    created_by: uuid.UUID | None
    created_at: datetime

class MetricValueRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    metric_id: int
    val_a: float | None
    val_b: float | None
    calculated_x: float | None
    quality_level: str | None
    expert_comment: str | None
    artifact_links: list[str] | None
    data_source: str

class MetricValueUpdate(BaseModel):
    val_a: float | None = Field(None, ge=0)
    val_b: float | None = Field(None, ge=0)
    expert_comment: str | None = Field(None, max_length=2000)
    artifact_links: list[str] | None = Field(None, max_length=50)

    @field_validator("artifact_links")
    @classmethod
    def validate_artifact_links(cls, v):
        if v is None:
            return v
        for link in v:
            if not link.startswith(("http://", "https://")):
                raise ValueError(f"Некорректный URL: {link!r}")
        return v

class ExpertJudgmentCreate(BaseModel):
    assessment_value_id: uuid.UUID
    adjusted_level: str = Field(..., min_length=1, max_length=50)
    justification_text: str = Field(..., min_length=10, max_length=5000)
    linked_risk_task: str | None = Field(None, max_length=500)

class ExpertJudgmentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    assessment_value_id: uuid.UUID
    original_level: str | None
    adjusted_level: str
    justification_text: str
    linked_risk_task: str | None
    created_by: uuid.UUID | None
    created_at: datetime

class MetricsListResponse(BaseModel):
    period_id: uuid.UUID
    metrics: list[MetricValueRead]