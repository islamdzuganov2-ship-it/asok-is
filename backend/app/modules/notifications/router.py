"""REST API журнала уведомлений (ТЗ v19 п.6, УК-15) — /api/v1/notifications."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.database import get_db
from app.modules.iam import require_permission
from app.modules.notifications import service
from app.modules.notifications.schemas import NotificationDeliveryOut, RetryOut, UndeliverableOut

router = APIRouter()
_VIEW = "view.admin.notifications"


def _out(row) -> NotificationDeliveryOut:
    out = NotificationDeliveryOut.model_validate(row)
    out.has_attachments = bool(row.attachments)
    return out


@router.get("/log", response_model=list[NotificationDeliveryOut])
async def get_log(
    status: str | None = Query(None), entity_id: str | None = Query(None),
    limit: int = Query(200, ge=1, le=1000),
    db: AsyncSession = Depends(get_db), _: dict = Depends(require_permission(_VIEW)),
):
    """Журнал отправок: каждое событие — с адресом, статусом, числом попыток и причиной."""
    return [_out(r) for r in await service.list_log(db, status=status, entity_id=entity_id, limit=limit)]


@router.get("/undeliverable", response_model=list[UndeliverableOut])
async def get_undeliverable(db: AsyncSession = Depends(get_db), _: dict = Depends(require_permission(_VIEW))):
    """Отчёт «недоставляемые»: кому уведомления не доходят и почему (нет email, не найден)."""
    return await service.undeliverable_report(db)


@router.post("/retry", response_model=RetryOut)
async def retry(db: AsyncSession = Depends(get_db), _: dict = Depends(require_permission(_VIEW))):
    """Повторить отправку упавших (FAILED) — то же, что делает ночная задача."""
    return RetryOut(delivered=await service.retry_failed(db))
