from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db
from app.models.system import CriticalityClass, LifecycleStatus, System

router = APIRouter()


class SystemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True, use_enum_values=True)

    id: UUID
    name: str
    code: Optional[str] = None
    status_lc: str
    criticality_class: str
    is_active: bool


class SystemsListResponse(BaseModel):
    items: list[SystemResponse]
    total: int
    page: int
    limit: int


class SystemCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    code: str | None = Field(None, max_length=50)
    status_lc: str = "ОЭ"
    criticality_class: str
    owner: str | None = Field(None, max_length=255)
    is_active: bool = True


@router.get("", response_model=SystemsListResponse)
async def list_systems(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=100),
    status_lc: Optional[str] = None,
    is_active: Optional[bool] = True,
    db: AsyncSession = Depends(get_db),
) -> SystemsListResponse:
    filters = [System.is_deleted.is_(False)]
    if status_lc:
        filters.append(System.status_lc == status_lc)
    if is_active is not None:
        filters.append(System.is_active.is_(is_active))

    total_result = await db.execute(select(func.count()).select_from(System).where(*filters))
    total = int(total_result.scalar_one())
    result = await db.execute(
        select(System)
        .where(*filters)
        .order_by(System.name)
        .offset((page - 1) * limit)
        .limit(limit)
    )
    return SystemsListResponse(
        items=list(result.scalars().all()),
        total=total,
        page=page,
        limit=limit,
    )


@router.get("/{system_id}", response_model=SystemResponse)
async def get_system(system_id: UUID, db: AsyncSession = Depends(get_db)) -> System:
    system = await db.get(System, system_id)
    if system is None or system.is_deleted:
        raise HTTPException(status_code=404, detail="System not found")
    return system


@router.post("", response_model=SystemResponse, status_code=201)
async def create_system(payload: SystemCreate, db: AsyncSession = Depends(get_db)) -> System:
    if payload.code:
        existing = await db.execute(select(System).where(System.code == payload.code))
        if existing.scalar_one_or_none() is not None:
            raise HTTPException(status_code=409, detail="System code already exists")

    data = payload.model_dump()
    try:
        data["status_lc"] = LifecycleStatus(data["status_lc"])
        data["criticality_class"] = CriticalityClass(data["criticality_class"])
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Unknown system enum value") from exc

    system = System(**data)
    db.add(system)
    await db.commit()
    await db.refresh(system)
    return system
