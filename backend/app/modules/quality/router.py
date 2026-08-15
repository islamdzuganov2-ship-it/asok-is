"""
REST API домена quality — каталог метрик (ТЗ v13).

RBAC: чтение каталога — всем аутентифицированным (нужен формам ввода и дашбордам),
правка — по праву `quality.catalog.edit`, которое по умолчанию есть только у встроенных
ролей (ADMIN/SUPER_ADMIN). Каталог — справочные данные модели качества ISO 25010, на них
опираются все оценки, включая закрытые периоды.

До 2026-08-15 роутер не имел ни одного гейта: анонимный `DELETE /metrics/{id}` доходил до
тела обработчика и удалил бы строку каталога (ДЕФ-01). Инвариант «каждый маршрут под
гейтом» стережёт `tests/test_route_guards.py`.
"""
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.database import get_db
from app.modules.iam import get_current_user, require_permission
from app.modules.quality.models import FormulaType, MetricCatalog
from app.modules.quality.schemas import MetricCreate, MetricOut, MetricUpdate

router = APIRouter()


def _formula_type(value: str) -> FormulaType:
    try:
        return FormulaType(value)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Unknown formula_type") from exc


@router.get("/", response_model=List[MetricOut])
async def get_metrics(
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(get_current_user),
) -> list[MetricCatalog]:
    result = await db.execute(select(MetricCatalog).order_by(MetricCatalog.id))
    return list(result.scalars().all())


@router.post("/", response_model=MetricOut, status_code=status.HTTP_201_CREATED)
async def create_metric(
    metric_data: MetricCreate,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("quality.catalog.edit")),
) -> MetricCatalog:
    payload = metric_data.model_dump(exclude_none=True)
    payload["formula_type"] = _formula_type(payload["formula_type"])
    metric = MetricCatalog(**payload)
    db.add(metric)
    await db.commit()
    await db.refresh(metric)
    return metric


@router.put("/{metric_id}", response_model=MetricOut)
async def update_metric(
    metric_id: int,
    metric_data: MetricUpdate,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("quality.catalog.edit")),
) -> MetricCatalog:
    payload = metric_data.model_dump(exclude_unset=True)
    if "formula_type" in payload:
        payload["formula_type"] = _formula_type(payload["formula_type"])

    result = await db.execute(
        update(MetricCatalog)
        .where(MetricCatalog.id == metric_id)
        .values(**payload)
        .returning(MetricCatalog)
    )
    updated = result.scalar_one_or_none()
    if updated is None:
        raise HTTPException(status_code=404, detail="Metric not found")

    await db.commit()
    return updated


@router.delete("/{metric_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_metric(
    metric_id: int,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("quality.catalog.edit")),
) -> None:
    result = await db.execute(delete(MetricCatalog).where(MetricCatalog.id == metric_id))
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Metric not found")
    await db.commit()
