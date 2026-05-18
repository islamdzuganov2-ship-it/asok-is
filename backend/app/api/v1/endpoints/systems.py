from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional, List
from pydantic import BaseModel, Field
from uuid import UUID
from datetime import datetime

from app.api.deps import get_db

router = APIRouter()

class SystemResponse(BaseModel):
    id: UUID
    name: str
    code: Optional[str] = None
    status_lc: str
    criticality_class: str
    is_active: bool
    created_at: datetime
    
    class Config:
        from_attributes = True

class SystemsListResponse(BaseModel):
    items: List[SystemResponse]
    total: int
    page: int
    limit: int

@router.get("", response_model=SystemsListResponse, tags=["systems"])
async def list_systems(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=100),
    status_lc: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """
    Получение списка информационных систем с фильтрацией.
    """
    # 🔴 TODO: Реальный запрос к БД
    # Пока возвращаем заглушку
    return SystemsListResponse(
        items=[],
        total=0,
        page=page,
        limit=limit
    )

@router.get("/{system_id}", response_model=SystemResponse, tags=["systems"])
async def get_system(system_id: UUID, db: AsyncSession = Depends(get_db)):
    """Получение детальной информации об ИС"""
    # 🔴 TODO: Реальный запрос к БД
    raise HTTPException(status_code=404, detail="Система не найдена (заглушка)")