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
from app.models.assessment import AssessmentValue
from app.services.calculation_engine import calculate_metric, map_to_level

router = APIRouter()

@router.get("/{id}/metrics", response_model=List[EditableMetricOut])
async def get_assessment_metrics(id: str, db: AsyncSession = Depends(get_db)):
    """
    TODO: Извлечение метрик для заполнения из БД.
    """
    return []

@router.put("/{id}/metrics")
async def save_assessment_metrics(
    id: str, 
    metrics: List[EditableMetricIn],
    db: AsyncSession = Depends(get_db)
):
    """
    Принимает сырые данные от Тест-Аналитика, пропускает их через 
    Calculation Engine и сохраняет в БД.
    """
    for metric_in in metrics:
        try:
            # В production среде id должен быть валидным UUID
            metric_uuid = uuid.UUID(metric_in.id)
        except ValueError:
            continue # Пропуск мок-данных фронтенда (id='1', '2' и т.д.)

        # Загружаем значение метрики и присоединяем справочник для получения типа формулы
        stmt = select(AssessmentValue).options(selectinload(AssessmentValue.metric)).where(AssessmentValue.id == metric_uuid)
        result = await db.execute(stmt)
        assessment_value = result.scalar_one_or_none()
        
        if not assessment_value:
            continue

        # Сохранение первичных данных
        assessment_value.val_a = metric_in.val_a
        assessment_value.val_b = metric_in.val_b
        assessment_value.expert_comment = metric_in.expert_comment

        # Запуск Вычислительного ядра
        if metric_in.val_a is not None and metric_in.val_b is not None:
            # Получаем тип формулы (DIRECT или INVERSE) из справочника
            formula_type = assessment_value.metric.formula_type.name if assessment_value.metric else "DIRECT"
            
            calculated_x = calculate_metric(metric_in.val_a, metric_in.val_b, formula_type)
            quality_level = map_to_level(calculated_x)
            
            assessment_value.calculated_x = calculated_x
            assessment_value.quality_level = quality_level
        
        db.add(assessment_value)
        
    await db.commit()
    return {"status": "ok", "message": "Метрики успешно рассчитаны и сохранены в БД"}

@router.get("/{id}/calculated", response_model=List[CalculatedMetricOut])
async def get_calculated_metrics(id: str, db: AsyncSession = Depends(get_db)):
    """
    TODO: Извлечение рассчитанных метрик для экрана Экспертизы.
    """
    return []

@router.post("/expert-judgment")
async def submit_expert_judgment(judgment: ExpertJudgmentCreate, db: AsyncSession = Depends(get_db)):
    """
    TODO: Запись эвристической корректировки в БД (ExpertJudgmentHistory).
    """
    return {"status": "ok", "message": "Профессиональное суждение сохранено"}