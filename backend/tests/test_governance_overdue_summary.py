"""Просрочка и Ц_ОМ портфельно (ТЗ v21, КП-13 — плитка CEO «Держим ли мы слово?»).

Ц_ОМ уже считается поштучно (`/proposals/{pid}/price-of-inaction`); эта агрегация суммирует
уже посчитанные значения (`ale_at_risk_current`/`_snapshot`), не пересчитывая формулу заново.
"""
from datetime import datetime, timedelta, timezone

from app.modules.governance.economics_service import overdue_summary
from app.modules.governance.models import Proposal
from app.modules.systems.models import CriticalityClass, System

NOW = datetime.now(timezone.utc)


async def test_no_overdue_proposals_is_empty(db_session):
    s = await overdue_summary(db_session)
    assert s.overdue_count == 0
    assert s.total_price_current == 0.0
    assert s.items == []


async def test_aggregates_overdue_by_owner_using_stored_price(db_session):
    overdue1 = Proposal(
        system_name="АБС Core", status="APPROVED", characteristic="Надёжность",
        owner="Иванов", due_on=NOW - timedelta(days=5),
        ale_at_risk_current=750_000, ale_at_risk_snapshot=500_000,
    )
    overdue2 = Proposal(
        system_name="CRM ОПК", status="APPROVED", characteristic="Защищённость",
        owner="Иванов", due_on=NOW - timedelta(days=1),
        ale_at_risk_current=250_000, ale_at_risk_snapshot=250_000,
    )
    # Не просрочена (due_on в будущем) — не должна попасть в сводку.
    not_overdue = Proposal(
        system_name="АБС Core", status="APPROVED", characteristic="Производительность",
        owner="Петров", due_on=NOW + timedelta(days=10),
    )
    # Выполнена — не считается просроченной, даже если срок прошёл.
    done_late = Proposal(
        system_name="АБС Core", status="APPROVED", characteristic="Тестируемость",
        owner="Петров", due_on=NOW - timedelta(days=20), execution="DONE",
    )
    db_session.add_all([overdue1, overdue2, not_overdue, done_late])
    await db_session.commit()

    s = await overdue_summary(db_session)
    assert s.overdue_count == 2
    assert s.owners_affected == 1
    assert s.total_price_current == 1_000_000.0
    assert s.total_price_snapshot == 750_000.0
    assert s.by_owner[0].owner == "Иванов" and s.by_owner[0].count == 2
    assert all(i.overdue_days >= 1 for i in s.items)


async def test_filters_by_system(db_session):
    import uuid
    sid_a = uuid.uuid4()
    p_a = Proposal(system_id=sid_a, system_name="ИС-А", status="APPROVED", owner="А",
                   due_on=NOW - timedelta(days=2), ale_at_risk_current=100_000)
    p_b = Proposal(system_id=uuid.uuid4(), system_name="ИС-Б", status="APPROVED", owner="Б",
                   due_on=NOW - timedelta(days=2), ale_at_risk_current=200_000)
    db_session.add_all([p_a, p_b])
    await db_session.commit()

    s = await overdue_summary(db_session, system_id=[sid_a])
    assert s.overdue_count == 1
    assert s.items[0].system_name == "ИС-А"


async def test_filters_by_criticality_and_characteristic(db_session):
    mc = System(name="ИС-MC", criticality_class=CriticalityClass.MISSION_CRITICAL)
    bo = System(name="ИС-BO", criticality_class=CriticalityClass.BUSINESS_OPERATIONAL)
    db_session.add_all([mc, bo])
    await db_session.commit()
    await db_session.refresh(mc)
    await db_session.refresh(bo)

    p_mc = Proposal(system_id=mc.id, system_name=mc.name, status="APPROVED", owner="А",
                    characteristic="Надёжность", due_on=NOW - timedelta(days=2), ale_at_risk_current=100_000)
    p_bo = Proposal(system_id=bo.id, system_name=bo.name, status="APPROVED", owner="Б",
                    characteristic="Защищённость", due_on=NOW - timedelta(days=2), ale_at_risk_current=200_000)
    db_session.add_all([p_mc, p_bo])
    await db_session.commit()

    only_mc = await overdue_summary(db_session, criticality=["MISSION CRITICAL"])
    assert only_mc.overdue_count == 1 and only_mc.items[0].system_name == "ИС-MC"

    only_char = await overdue_summary(db_session, characteristic="Защищённость")
    assert only_char.overdue_count == 1 and only_char.items[0].system_name == "ИС-BO"
