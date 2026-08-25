"""Доступность и MTBF в аналитике сбоев (ТЗ v21, КП-30 — плитка CTO «Насколько мы надёжны?»).

Слайд 11 презентации обещает MTTR/MTBF/доступность на «Аналитике сбоев» — MTBF и доступность
в коде отсутствовали (только MTTR). Проверяет честную границу: без сбоев — None, не 0/100%.
"""
from datetime import datetime, timedelta, timezone

from app.modules.incidents import service
from app.modules.incidents.models import TechIncident


async def test_availability_none_without_incidents(db_session):
    a = await service.analytics(db_session)
    assert a.total == 0
    assert a.availability_pct is None
    assert a.mtbf_hours is None
    assert a.window_hours is None


async def test_availability_computed_from_downtime_over_window(db_session):
    now = datetime.now(timezone.utc)
    occurred = now - timedelta(days=10)  # окно ≈ 240 часов
    db_session.add(TechIncident(
        system_id=None, system_name="АБС Core", category="INFRASTRUCTURE", title="Отказ узла",
        occurred_at=occurred, resolved_at=occurred + timedelta(hours=2),
        downtime_minutes=120,  # 2 часа простоя
    ))
    await db_session.commit()

    a = await service.analytics(db_session)
    assert a.total == 1
    assert a.window_hours is not None and a.window_hours > 200
    # MTBF = окно / число сбоев (один сбой → MTBF = длина окна).
    assert a.mtbf_hours == a.window_hours
    # Доступность = 100 × (1 − простой/окно); один короткий простой → близко к 100%, не ровно.
    assert 95.0 < a.availability_pct < 100.0
