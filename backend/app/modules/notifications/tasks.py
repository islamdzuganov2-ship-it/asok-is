"""
Celery-задачи уведомлений (ТЗ v19 п.6, УК-15): повтор упавших отправок и события по расписанию.

Та же sync/async-обёртка, что governance/tasks.py — свой event loop и своя сессия БД.
Сканеры событий по расписанию живут в доменах (governance — «срок истекает», assessment —
«измерение просрочено»): модуль уведомлений не знает о мерах и оценках, только о событиях.
"""
from __future__ import annotations

import asyncio
import logging

from app.infrastructure.workers import celery_app

logger = logging.getLogger(__name__)


async def _retry() -> int:
    from app.infrastructure.database import AsyncSessionLocal
    from app.modules.notifications.service import retry_failed

    async with AsyncSessionLocal() as db:
        return await retry_failed(db)


async def _scan() -> dict:
    from app.infrastructure.database import AsyncSessionLocal
    from app.modules.assessment.notifications_scan import notify_overdue_measurements
    from app.modules.governance.notifications_scan import notify_due_soon

    async with AsyncSessionLocal() as db:
        return {
            "due_soon": await notify_due_soon(db),
            "measurement_overdue": await notify_overdue_measurements(db),
        }


@celery_app.task(name="tasks.notifications_retry_failed")
def notifications_retry_failed_task() -> dict:
    delivered = asyncio.run(_retry())
    logger.info("notifications_retry_failed: доставлено повторно %d", delivered)
    return {"status": "COMPLETED", "delivered": delivered}


@celery_app.task(name="tasks.notifications_daily_scan")
def notifications_daily_scan_task() -> dict:
    """Ежедневные события УК-15: «срок меры истекает через N дней», «измерение просрочено»."""
    counts = asyncio.run(_scan())
    logger.info("notifications_daily_scan: %s", counts)
    return {"status": "COMPLETED", **counts}
