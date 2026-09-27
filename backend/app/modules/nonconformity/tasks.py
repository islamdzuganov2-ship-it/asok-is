"""
Celery-задачи домена nonconformity (ТЗ v19 §17.9, УК-59, УК-60): автоэскалация по SLA
(несоответствия и меры).

Та же sync/async-обёртка, что governance/tasks.py — свой event loop и своя сессия БД.
"""
from __future__ import annotations

import asyncio
import logging

from app.infrastructure.workers import celery_app

logger = logging.getLogger(__name__)


async def _auto_escalate() -> int:
    from app.infrastructure.database import AsyncSessionLocal
    from app.modules.nonconformity.service import auto_escalate_overdue, auto_escalate_overdue_measures

    async with AsyncSessionLocal() as db:
        return await auto_escalate_overdue(db) + await auto_escalate_overdue_measures(db)


@celery_app.task(name="tasks.nonconformity_sla_autoescalate")
def sla_autoescalate_task() -> dict:
    """Автоэскалация несоответствий и мер, просроченных по SLA (§17.9, УК-60) — дифференцирован
    по критичности: минор/major — 30 дней, critical/блокирующая — 3 дня (nonconformity/service.py)."""
    count = asyncio.run(_auto_escalate())
    logger.info("nonconformity_sla_autoescalate: эскалировано %d карточек", count)
    return {"status": "COMPLETED", "escalated": count}
