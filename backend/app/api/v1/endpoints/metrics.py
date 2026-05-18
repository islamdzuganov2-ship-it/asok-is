# backend/app/api/v1/endpoints/metrics.py
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List

from app.api.deps import get_db
from app.models.metric_catalog import MetricCatalog, FormulaType
from app.schemas.metric import MetricCatalogResponse
from app.api.v1.endpoints import assessments, metrics
router = APIRouter(prefix="/metrics", tags=["metrics"])

from fastapi import APIRouter
router = APIRouter()

@router.get("", response_model=List[MetricCatalogResponse])
async def list_metrics(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user)  # опционально
):
    """Получение справочника всех активных метрик"""
    result = await db.execute(
        select(MetricCatalog)
        .where(MetricCatalog.is_active == True)
        .order_by(MetricCatalog.characteristic, MetricCatalog.subcharacteristic)
    )
    metrics = result.scalars().all()
    
    return [
        MetricCatalogResponse(
            id=m.id,
            characteristic=m.characteristic,
            subcharacteristic=m.subcharacteristic,
            formula_type=m.formula_type.value,
            description=m.description,
            data_source=m.data_source
        )
        for m in metrics
    ]