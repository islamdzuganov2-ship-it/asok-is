from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import uuid
from app.api.deps import get_db, get_current_user
from app.models.assessment import AssessmentPeriod, AssessmentValue
from app.models.metric_catalog import MetricCatalog
from app.schemas.assessment import AssessmentValueCreate, AssessmentValueResponse
from app.services.calculation_engine import calculate_metric_value

router = APIRouter(prefix="/assessments", tags=["assessments"])

from pydantic import BaseModel, Field, field_validator
import uuid as uuid_module

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
    heatmapData: List[Tuple[int, int, int]]  # [x_index, y_index, quality_score_0_to_5]
    xAxisLabels: List[str]
    yAxisLabels: List[str]
    problematicSystems: List[ProblematicSystemOut]

# --- СХЕМЫ ДЛЯ ВВОДА МЕТРИК (ТЕСТ-АНАЛИТИК) ---
class EditableMetricBase(BaseModel):
    id: str  # В реальности тут может быть int или UUID метрики
    name: str
    description: str
    val_a: float | None = None
    val_b: float | None = None
    expert_comment: str

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
    metricId: str # Или UUID, в зависимости от вашей БД
    calculatedLevel: str
    adjustedLevel: Optional[str] = None
    justificationText: str
    linkedRiskTask: Optional[str] = None
class CreateAssessmentPeriodRequest(BaseModel):
    system_id: str = Field(..., description="UUID системы")
    period: str = Field(..., pattern=r"^Q[1-4]-\d{4}$", description="Q1-2026")
    
    @field_validator('system_id')
    @classmethod
    def validate_uuid(cls, v: str) -> str:
        try:
            uuid_module.UUID(v)
            return v
        except ValueError:
            raise ValueError('Неверный UUID')

# assessments.py — ИСПРАВИТЬ эндпоинт
@router.post("", status_code=status.HTTP_201_CREATED)
async def create_assessment_period(
    request: CreateAssessmentPeriodRequest,  # ✅ Валидация через Pydantic
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    system_id = uuid.UUID(request.system_id)  # Конвертация после валидации
    # ... остальная логика

@router.put("/{assessment_id}/metrics/{metric_id}", response_model=AssessmentValueResponse)
async def update_assessment_metric(
    assessment_id: uuid.UUID,
    metric_id: int,
    metric_in: AssessmentValueCreate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user)
):
    # Получаем метрику для определения формулы
    result = await db.execute(select(MetricCatalog).where(MetricCatalog.id == metric_id))
    metric = result.scalar_one_or_none()
    if not metric:
        raise HTTPException(status_code=404, detail="Метрика не найдена")

    # Расчет
    calc_x, level = calculate_metric_value(metric_in.val_a, metric_in.val_b, metric.formula_type.value)

    # Обновление или создание
    result = await db.execute(select(AssessmentValue).where(
        AssessmentValue.period_id == assessment_id,
        AssessmentValue.metric_id == metric_id
    ))
    value = result.scalar_one_or_none()

    if value:
        value.val_a = metric_in.val_a
        value.val_b = metric_in.val_b
        value.calculated_x = calc_x
        value.quality_level = level
    else:
        value = AssessmentValue(
            period_id=assessment_id, metric_id=metric_id,
            val_a=metric_in.val_a, val_b=metric_in.val_b,
            calculated_x=calc_x, quality_level=level
        )
        db.add(value)
    
    await db.commit()
    await db.refresh(value)
    return AssessmentValueResponse(
        id=value.id, metric_id=value.metric_id,
        calculated_x=value.calculated_x, quality_level=value.quality_level
    )