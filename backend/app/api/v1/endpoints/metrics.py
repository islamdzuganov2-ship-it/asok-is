"""
Эндпоинты каталога метрик.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List

from app.core.database import get_db
from app.models.metric import MetricCatalog
from app.schemas.metric import MetricCreate, MetricUpdate, MetricOut

router = APIRouter()

@router.get("/", response_model=List[MetricOut])
async def get_metrics(db: AsyncSession = Depends(get_db)):
    """Получить список всех метрик."""
    try:
        result = await db.execute(select(MetricCatalog))
        metrics = result.scalars().all()
        return metrics
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Ошибка получения метрик: {str(e)}"
        )

@router.post("/", response_model=MetricOut, status_code=201)
async def create_metric(
    metric_data: MetricCreate,
    db: AsyncSession = Depends(get_db)
):
    """Создать новую метрику."""
    try:
        metric = MetricCatalog(**metric_data.dict())
        db.add(metric)
        await db.commit()
        await db.refresh(metric)
        return metric
    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Ошибка создания метрики: {str(e)}"
        )

@router.put("/{metric_id}", response_model=MetricOut)
async def update_metric(
    metric_id: int,
    metric_data: MetricUpdate,
    db: AsyncSession = Depends(get_db)
):
    """Обновить метрику."""
    try:
        stmt = (
            __import__('sqlalchemy').update(MetricCatalog)
            .where(MetricCatalog.id == metric_id)
            .values(**metric_data.dict(exclude_unset=True))
            .returning(MetricCatalog)
        )
        result = await db.execute(stmt)
        updated = result.scalar_one_or_none()
        if not updated:
            raise HTTPException(status_code=404, detail="Метрика не найдена")
        await db.commit()
        return updated
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Ошибка обновления метрики: {str(e)}"
        )

@router.delete("/{metric_id}", status_code=204)
async def delete_metric(metric_id: int, db: AsyncSession = Depends(get_db)):
    """Удалить метрику."""
    try:
        stmt = __import__('sqlalchemy').delete(MetricCatalog).where(MetricCatalog.id == metric_id)
        result = await db.execute(stmt)
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Метрика не найдена")
        await db.commit()
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Ошибка удаления метрики: {str(e)}"
        )