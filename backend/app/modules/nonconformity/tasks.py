"""
Celery-задачи домена nonconformity (ТЗ v19 §17.9, УК-59/60): автоэскалация по SLA.

Та же sync/async-обёртка, что governance/tasks.py — свой event loop и своя сессия БД.
"""
from __future__ import annotations

import asyncio
import logging

from app.infrastructure.workers import celery_app

logger = logging.getLogger(__name__)


async def _auto_escalate() -> int:
    from app.infrastructure.database import AsyncSessionLocal
    from app.modules.nonconformity.service import auto_escalate_overdue

    async with AsyncSessionLocal() as db:
        return await auto_escalate_overdue(db)


@celery_app.task(name="tasks.nonconformity_sla_autoescalate")
def sla_autoescalate_task() -> dict:
    """Автоэскалация несоответствий, просроченных по SLA (§17.9) — дифференцирован по
    критичности (`nc.level`): минор/major — 30 дней, critical — 3 дня (nonconformity/service.py)."""
    count = asyncio.run(_auto_escalate())
    logger.info("nonconformity_sla_autoescalate: эскалировано %d несоответствий", count)
    return {"status": "COMPLETED", "escalated": count}
