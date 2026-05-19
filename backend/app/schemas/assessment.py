from pydantic import BaseModel
from typing import List, Tuple, Optional
from uuid import UUID

# --- СХЕМЫ ДЛЯ ДАШБОРДА (C-LEVEL) ---
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

# --- СХЕМЫ ДЛЯ ВВОДА МЕТРИК (ТЕСТ-АНАЛИТИК) ---
class EditableMetricBase(BaseModel):
    id: str
    name: str
    description: str
    val_a: Optional[float] = None
    val_b: Optional[float] = None
    expert_comment: Optional[str] = ""

class EditableMetricIn(EditableMetricBase):
    pass

class EditableMetricOut(EditableMetricBase):
    pass

# --- СХЕМЫ ДЛЯ РЕВЬЮ И ПРОФ. СУЖДЕНИЯ (МЕНЕДЖЕР) ---
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
    justificationText: str
    linkedRiskTask: Optional[str] = None