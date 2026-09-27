"""
События уведомлений по расписанию для оценок (ТЗ v19 п.6, УК-15): «измерение просрочено».

Оценка ведётся поквартально: к началу квартала должна быть оценка за прошедший. ИС, у которой
последний период старше прошедшего квартала (или периодов нет вовсе), — просрочена; владельцу ИС
уходит одно уведомление на ожидаемый квартал (ключ дедупликации).
"""
from __future__ import annotations

from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.assessment.models import AssessmentPeriod
from app.modules.notifications import emit
from app.modules.systems import System
from app.shared.notification_events import EVENT_MEASUREMENT_OVERDUE
from app.shared.periods import period_sort_key


def expected_period(today: date) -> str:
    """Прошедший квартал относительно даты: 15.02.2027 → «Q4-2026»."""
    q = (today.month - 1) // 3 + 1
    return f"Q4-{today.year - 1}" if q == 1 else f"Q{q - 1}-{today.year}"


async def notify_overdue_measurements(db: AsyncSession, *, today: date | None = None) -> int:
    today = today or date.today()
    expected = expected_period(today)
    systems = list((await db.execute(
        select(System).where(System.is_active.is_(True), System.is_deleted.is_(False))
    )).scalars().all())
    periods = (await db.execute(select(AssessmentPeriod.system_id, AssessmentPeriod.period))).all()
    latest: dict = {}
    for system_id, label in periods:
        if system_id not in latest or period_sort_key(label) > period_sort_key(latest[system_id]):
            latest[system_id] = label
    sent = 0
    for s in systems:
        last = latest.get(s.id)
        if last and period_sort_key(last) >= period_sort_key(expected):
            continue
        row = await emit(
            db, EVENT_MEASUREMENT_OVERDUE, s.owner, entity_type="system", entity_id=str(s.id),
            dedupe_key=f"measurement_overdue:{s.id}:{expected}", commit=False,
            system=s.name, last_period=last or "оценок нет", expected_period=expected,
        )
        sent += row is not None
    await db.commit()
    return sent
