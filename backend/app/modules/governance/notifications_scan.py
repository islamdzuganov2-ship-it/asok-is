"""
События уведомлений по расписанию для мер (ТЗ v19 п.6, УК-15): «срок меры истекает через N дней».

Ежедневный скан (notifications/tasks.py). Одно уведомление на меру и дату срока (ключ
дедупликации): перенос срока — новое уведомление, повторный прогон в тот же день — нет.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.governance.models import EXECUTION_DONE, STATUS_APPROVED, Proposal
from app.modules.notifications import emit
from app.shared.notification_events import EVENT_MEASURE_DUE_SOON

DUE_SOON_DAYS_DEFAULT = 3


async def notify_due_soon(db: AsyncSession, *, days: int | None = None, now: datetime | None = None) -> int:
    from app.modules.econ import config_value  # отложенно: econ тянет governance (цикл при старте)

    days = int(days if days is not None else (await config_value(db, "notify_due_soon_days", DUE_SOON_DAYS_DEFAULT)
                                               or DUE_SOON_DAYS_DEFAULT))
    now = now or datetime.now(timezone.utc)
    rows = list((await db.execute(
        select(Proposal).where(
            Proposal.status == STATUS_APPROVED,
            Proposal.due_on.is_not(None),
            Proposal.due_on >= now,
            Proposal.due_on <= now + timedelta(days=days),
            or_(Proposal.execution.is_(None), Proposal.execution != EXECUTION_DONE),
        )
    )).scalars().all())
    sent = 0
    for p in rows:
        left = max((p.due_on.date() - now.date()).days, 0)
        row = await emit(
            db, EVENT_MEASURE_DUE_SOON, p.owner, entity_type="proposal", entity_id=str(p.id),
            dedupe_key=f"due_soon:{p.id}:{p.due_on.date().isoformat()}", commit=False,
            days=left, title=p.risk_title or p.metric_name or p.system_name or "мера",
            system=p.system_name or "—", due=p.due_on.strftime("%d.%m.%Y"),
        )
        sent += row is not None
    await db.commit()
    return sent
