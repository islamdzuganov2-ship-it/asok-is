"""
Эндпоинты для работы с периодами и значениями оценок.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, delete
from typing import List

from app.core.database import get_db
from app.models.assessment import AssessmentPeriod, AssessmentValue
from app.schemas.assessment import (
    PeriodCreate, PeriodUpdate, PeriodOut,
    ValueCreate, ValueOut
)

router = APIRouter()

# ------------------------------------------------------------------
# Периоды оценки
# ------------------------------------------------------------------
@router.get("/periods", response_model=List[PeriodOut])
async def get_all_periods(db: AsyncSession = Depends(get_db)):
    """Получить список всех периодов оценки."""
    try:
        result = await db.execute(
            select(AssessmentPeriod).order_by(AssessmentPeriod.start_date.desc())
        )
        periods = result.scalars().all()
        return periods
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Ошибка получения периодов: {str(e)}"
        )

@router.post("/periods", response_model=PeriodOut, status_code=201)
async def create_period(
    period_data: PeriodCreate,
    db: AsyncSession = Depends(get_db)
):
    """Создать новый период оценки."""
    try:
        period = AssessmentPeriod(**period_data.dict())
        db.add(period)
        await db.commit()
        await db.refresh(period)
        return period
    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Ошибка создания периода: {str(e)}"
        )

@router.put("/periods/{period_id}", response_model=PeriodOut)
async def update_period(
    period_id: int,
    period_data: PeriodUpdate,
    db: AsyncSession = Depends(get_db)
):
    """Обновить существующий период оценки."""
    try:
        stmt = (
            update(AssessmentPeriod)
            .where(AssessmentPeriod.id == period_id)
            .values(**period_data.dict(exclude_unset=True))
            .returning(AssessmentPeriod)
        )
        result = await db.execute(stmt)
        updated_period = result.scalar_one_or_none()
        if not updated_period:
            raise HTTPException(status_code=404, detail="Период не найден")
        await db.commit()
        return updated_period
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Ошибка обновления периода: {str(e)}"
        )

@router.delete("/periods/{period_id}", status_code=204)
async def delete_period(period_id: int, db: AsyncSession = Depends(get_db)):
    """Удалить период оценки."""
    try:
        stmt = delete(AssessmentPeriod).where(AssessmentPeriod.id == period_id)
        result = await db.execute(stmt)
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Период не найден")
        await db.commit()
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Ошибка удаления периода: {str(e)}"
        )

# ------------------------------------------------------------------
# Значения оценок
# ------------------------------------------------------------------
@router.get("/values", response_model=List[ValueOut])
async def get_all_values(db: AsyncSession = Depends(get_db)):
    """Получить список всех значений оценок."""
    try:
        result = await db.execute(select(AssessmentValue))
        values = result.scalars().all()
        return values
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Ошибка получения значений: {str(e)}"
        )

@router.post("/values", response_model=ValueOut, status_code=201)
async def create_value(
    value_data: ValueCreate,
    db: AsyncSession = Depends(get_db)
):
    """Добавить новую оценку."""
    try:
        value = AssessmentValue(**value_data.dict())
        db.add(value)
        await db.commit()
        await db.refresh(value)
        return value
    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Ошибка добавления оценки: {str(e)}"
        )