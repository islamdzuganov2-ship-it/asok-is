from fastapi import APIRouter, Depends, HTTPException
from typing import List
from app.schemas.assessment import (
    EditableMetricOut, 
    EditableMetricIn, 
    CalculatedMetricOut, 
    ExpertJudgmentCreate
)

router = APIRouter()

@router.get("/{id}/metrics", response_model=List[EditableMetricOut])
async def get_assessment_metrics(id: str):
    # Заглушка для фронтенда
    return []

@router.put("/{id}/metrics")
async def save_assessment_metrics(id: str, metrics: List[EditableMetricIn]):
    # Заглушка сохранения
    return {"status": "ok", "message": "Metrics saved and calculation triggered"}

@router.get("/{id}/calculated", response_model=List[CalculatedMetricOut])
async def get_calculated_metrics(id: str):
    # Заглушка для фронтенда
    return []

@router.post("/expert-judgment")
async def submit_expert_judgment(judgment: ExpertJudgmentCreate):
    # Заглушка экспертного суждения
    return {"status": "ok", "message": "Expert judgment saved"}