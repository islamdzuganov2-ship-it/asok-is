"""Тесты домена incidents (T-21): CRUD техсбоев + аналитика надёжности на сервисном слое."""
from datetime import datetime, timedelta, timezone

import pytest

from app.modules.incidents import service
from app.modules.incidents.schemas import ResolveIn, TechIncidentCreate, TechIncidentUpdate
from app.shared.exceptions import NotFoundError, ValidationError

BASE = datetime(2026, 5, 1, 10, 0, tzinfo=timezone.utc)


def _new(system="АБС Core", category="INFRASTRUCTURE", severity="high", **kw) -> TechIncidentCreate:
    data = dict(system_name=system, category=category, severity=severity,
                title="Сбой", occurred_at=BASE)
    data.update(kw)
    return TechIncidentCreate(**data)


async def test_create_validates_category_and_severity(db_session):
    with pytest.raises(ValidationError):
        await service.create(db_session, _new(category="UNKNOWN"), "manager")
    with pytest.raises(ValidationError):
        await service.create(db_session, _new(severity="urgent"), "manager")
    inc = await service.create(db_session, _new(), "manager")
    assert inc.category == "INFRASTRUCTURE" and inc.created_by == "manager"


async def test_list_filters(db_session):
    await service.create(db_session, _new(system="АБС Core", category="NETWORK"), "m")
    await service.create(db_session, _new(system="CRM ОПК", category="RELEASE",
                                          resolved_at=BASE + timedelta(hours=3)), "m")
    assert len(await service.list_incidents(db_session)) == 2
    assert len(await service.list_incidents(db_session, system="АБС Core")) == 1
    assert len(await service.list_incidents(db_session, category="RELEASE")) == 1
    assert len(await service.list_incidents(db_session, status="open")) == 1       # без resolved_at
    assert len(await service.list_incidents(db_session, status="resolved")) == 1


async def test_resolve_sets_timestamp(db_session):
    inc = await service.create(db_session, _new(), "m")
    assert inc.resolved_at is None
    inc = await service.resolve(db_session, inc, ResolveIn(resolved_at=BASE + timedelta(hours=5)).resolved_at)
    assert inc.resolved_at == BASE + timedelta(hours=5)


async def test_update_validates(db_session):
    inc = await service.create(db_session, _new(), "m")
    with pytest.raises(ValidationError):
        await service.update(db_session, inc, TechIncidentUpdate(category="BAD"))
    inc = await service.update(db_session, inc, TechIncidentUpdate(severity="critical"))
    assert inc.severity == "critical"


async def test_analytics_aggregates(db_session):
    # 3 сбоя: 2 RELEASE (один закрыт за 2ч, один открыт), 1 NETWORK закрыт за 4ч.
    await service.create(db_session, _new(system="АБС Core", category="RELEASE",
                                          resolved_at=BASE + timedelta(hours=2)), "m")
    await service.create(db_session, _new(system="АБС Core", category="RELEASE"), "m")  # открыт
    await service.create(db_session, _new(system="CRM ОПК", category="NETWORK",
                                          resolved_at=BASE + timedelta(hours=4)), "m")

    a = await service.analytics(db_session)
    assert a.total == 3
    assert a.open_count == 1 and a.resolved_count == 2
    assert a.avg_mttr_hours == 3.0                       # (2 + 4) / 2
    assert a.release_induced_share == round(2 / 3 * 100, 1)  # 66.7%
    cats = {c.category: c for c in a.by_category}
    assert cats["RELEASE"].count == 2 and cats["RELEASE"].open_count == 1
    assert cats["RELEASE"].avg_mttr_hours == 2.0         # только закрытый RELEASE
    # Топ нестабильных: АБС Core (2) впереди CRM ОПК (1).
    assert a.top_systems[0].system_name == "АБС Core" and a.top_systems[0].count == 2


async def test_get_or_404(db_session):
    import uuid
    with pytest.raises(NotFoundError):
        await service.get_or_404(db_session, uuid.uuid4())
