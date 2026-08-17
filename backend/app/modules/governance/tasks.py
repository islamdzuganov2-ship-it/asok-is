"""
Celery-задачи домена governance (ТЗ v19 §17.4, УК-49): ежедневный пересчёт Ц_ОМ.

Sync-обёртка вокруг async-сервиса — Celery-воркер синхронный, БД асинхронная (тот же приём,
что в scripts/seed_demo.py и др.: свой event loop через asyncio.run, собственная сессия из
AsyncSessionLocal, а не переиспользование FastAPI-запросной сессии).
"""
from __future__ import annotations

import asyncio
import logging

from app.infrastructure.workers import celery_app

logger = logging.getLogger(__name__)


async def _recompute_overdue() -> int:
    from app.infrastructure.database import AsyncSessionLocal
    from app.modules.governance.economics_service import recompute_all_overdue_price_of_inaction

    async with AsyncSessionLocal() as db:
        return await recompute_all_overdue_price_of_inaction(db)


@celery_app.task(name="tasks.recompute_price_of_inaction")
def recompute_price_of_inaction_task() -> dict:
    """Ежедневный пересчёт Ц_ОМ по всем просроченным мерам (§17.4, УК-49) — снимок фиксируется
    один раз при первом обнаружении просрочки, текущее значение пересчитывается каждый прогон."""
    count = asyncio.run(_recompute_overdue())
    logger.info("recompute_price_of_inaction: пересчитано %d просроченных мер", count)
    return {"status": "COMPLETED", "recomputed": count}
