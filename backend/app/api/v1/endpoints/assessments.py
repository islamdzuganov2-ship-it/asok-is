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

@router.post("/", status_code=status.HTTP_201_CREATED)
async def create_assessment_period(
    system_id: str, 
    period: str,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user)
):
    new_period = AssessmentPeriod(system_id=system_id, period=period)
    db.add(new_period)
    await db.commit()
    await db.refresh(new_period)
    return {"id": str(new_period.id), "period": new_period.period, "status": new_period.status}

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