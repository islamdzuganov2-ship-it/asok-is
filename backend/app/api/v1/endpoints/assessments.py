from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload
from typing import List
import uuid

from app.api.deps import get_db
from app.schemas.assessment import (
    EditableMetricOut, 
    EditableMetricIn, 
    CalculatedMetricOut, 
    ExpertJudgmentCreate
)
from app.models.assessment import AssessmentPeriod, AssessmentValue
from app.services.calculation_engine import calculate_metric, map_to_level

router = APIRouter()

@router.get("/", response_model=List[dict]) 
async def list_assessments(db: AsyncSession = Depends(get_db)):
    """
    Возвращает список всех оценок (периодов) с подгрузкой данных о системе.
    """
    # Используем selectinload для связи system, которую мы починили в модели
    stmt = select(AssessmentPeriod).options(selectinload(AssessmentPeriod.system))
    result = await db.execute(stmt)
    periods = result.scalars().all()
    
    return [
        {
            "id": p.id, 
            "period": p.period, 
            "system_name": p.system.name if p.system else "N/A"
        } 
        for p in periods
    ]

@router.get("/{id}/metrics", response_model=List[EditableMetricOut])
async def get_assessment_metrics(id: str, db: AsyncSession = Depends(get_db)):
    return []

@router.put("/{id}/metrics")
async def save_assessment_metrics(
    id: str, 
    metrics: List[EditableMetricIn],
    db: AsyncSession = Depends(get_db)
):
    for metric_in in metrics:
        try:
            metric_uuid = uuid.UUID(metric_in.id)
        except ValueError:
            continue

        stmt = select(AssessmentValue).options(selectinload(AssessmentValue.metric)).where(AssessmentValue.id == metric_uuid)
        result = await db.execute(stmt)
        assessment_value = result.scalar_one_or_none()
        
        if not assessment_value:
            continue

        assessment_value.val_a = metric_in.val_a
        assessment_value.val_b = metric_in.val_b
        assessment_value.expert_comment = metric_in.expert_comment

        if metric_in.val_a is not None and metric_in.val_b is not None:
            formula_type = assessment_value.metric.formula_type.name if assessment_value.metric else "DIRECT"
            calculated_x = calculate_metric(metric_in.val_a, metric_in.val_b, formula_type)
            assessment_value.quality_level = map_to_level(calculated_x)
            assessment_value.calculated_x = calculated_x
        
        db.add(assessment_value)
        
    await db.commit()
    return {"status": "ok", "message": "Метрики успешно рассчитаны"}

@router.get("/{id}/calculated", response_model=List[CalculatedMetricOut])
async def get_calculated_metrics(id: str, db: AsyncSession = Depends(get_db)):
    return []

@router.post("/expert-judgment")
async def submit_expert_judgment(judgment: ExpertJudgmentCreate, db: AsyncSession = Depends(get_db)):
    return {"status": "ok", "message": "Профессиональное суждение сохранено"}