"""
Эндпоинт справочника метрик.
GET /api/v1/metrics — список всех активных метрик каталога МК_8.1.
Доступен всем аутентифицированным пользователям.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List

from app.api.deps import get_db
from app.core.rbac import require_any_authenticated
from app.models.metric_catalog import MetricCatalog
from app.schemas.metric import MetricCatalogResponse

router = APIRouter(prefix="/metrics", tags=["metrics"])


@router.get("", response_model=List[MetricCatalogResponse])
async def list_metrics(
    db: AsyncSession = Depends(get_db),
    _=Depends(require_any_authenticated),
):
    """Получение справочника всех активных метрик."""
    result = await db.execute(
        select(MetricCatalog).where(MetricCatalog.is_active == True)
    )
    return result.scalars().all()