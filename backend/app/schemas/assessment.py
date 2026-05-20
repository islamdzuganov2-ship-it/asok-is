from datetime import datetime
from typing import List, Optional, Tuple
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class RiskMatrixRow(BaseModel):
    """Схема строки таблицы возможных рисков ИС."""
    characteristic: str
    subcharacteristic: str
    risk_description: str
    risk_consequence: str
    mitigation_measures: str

class DefectMatrixRow(BaseModel):
    """Схема строки перечня недостатков качества ИС."""
    id: int
    characteristic: str
    digital_metric: Optional[str] = None
    quality_metric_level: Optional[str] = None
    defect_description: str

class QualityPlanMatrixRow(BaseModel):
    """Схема строки плана обеспечения качества ИС."""
    id: int
    characteristic: str
    subcharacteristic: str
    task_description: str
    internal_document: Optional[str] = None
    assignee_fio: Optional[str] = None
    assignee_role: Optional[str] = None
    assignee_department: Optional[str] = None
    deadline: str
    profile_executor: Optional[str] = None
    tech_debt_link: Optional[str] = None

class FullExcelMatricesOut(BaseModel):
    """Общий контейнер для передачи всех трех реестров на фронтенд."""
    period_id: UUID
    risks: List[RiskMatrixRow]
    defects: List[DefectMatrixRow]
    plan: List[QualityPlanMatrixRow]
    
class ProblematicSystemOut(BaseModel):
    id: UUID
    name: str
    criticality: str
    lowMetricsCount: int


class DashboardDataOut(BaseModel):
    globalHealthScore: float
    aiInsights: str
    heatmapData: List[Tuple[int, int, int]]
    xAxisLabels: List[str]
    yAxisLabels: List[str]
    problematicSystems: List[ProblematicSystemOut]


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
    description: str
    val_a: float | None = None
    val_b: float | None = None
    expert_comment: str | None = ""


class EditableMetricIn(BaseModel):
    id: str
    val_a: float | None = Field(None, ge=0)
    val_b: float | None = Field(None, ge=0)
    expert_comment: str | None = Field("", max_length=2000)


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


class TemplateDataOut(BaseModel):
    """Generic template data container."""
    filename: str
    sheetName: str
    data: List[dict]


class AllTemplatesOut(BaseModel):
    """Container for all available templates."""
    metrics: List[dict] = []
    risks: List[dict] = []
    qualityReport: List[dict] = []
    systemQuality: List[dict] = []
