"""Pydantic-схемы домена reporting (дашборды, Excel-матрицы), ТЗ v13.

Выделены из бывшего app/schemas/assessment.py: это контракты ОТЧЁТНОСТИ, а не оценки.
"""
from typing import List, Optional, Tuple
from uuid import UUID

from pydantic import BaseModel


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
