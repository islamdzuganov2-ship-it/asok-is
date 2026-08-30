"""Очередь решений по матрице акцепта (ТЗ v21, КП-11 — плитка CEO «Что требует моей подписи?»).

Слайд 4 обещает матрицу акцепта («до 1 млн — владелец ИС, 1–10 млн — CIO, свыше — правление»),
но до этого ТЗ она нигде не читалась во фронте — только записывалась при решении по одному
несоответствию. Эта очередь строит её из несоответствий, ОЖИДАЮЩИХ решения (EVALUATED).
"""
from datetime import datetime, timedelta, timezone

from app.modules.econ.acceptance_queue_service import acceptance_queue
from app.modules.econ.models import EconConfig
from app.modules.nonconformity.models import STATUS_EVALUATED, STATUS_IDENTIFIED, Nonconformity
from app.modules.risk.models import RiskEvent
from app.modules.systems.models import CriticalityClass, System


async def _set_matrix(db_session):
    db_session.add(EconConfig(key="acceptance_matrix", value=[
        {"max_ale": 1_000_000, "signer": "Владелец ИС"},
        {"max_ale": 10_000_000, "signer": "CIO"},
        {"max_ale": None, "signer": "Правление/комитет"},
    ]))
    await db_session.commit()


async def test_queue_empty_without_evaluated_nonconformities(db_session):
    await _set_matrix(db_session)
    q = await acceptance_queue(db_session)
    assert q.items == []
    assert q.matrix_applied[0].signer == "Владелец ИС"


async def test_queue_assigns_signer_by_ale_and_flags_overdue(db_session):
    await _set_matrix(db_session)
    sys = System(name="ИС-Акцепт", criticality_class=CriticalityClass.MISSION_CRITICAL)
    db_session.add(sys)
    await db_session.commit()
    await db_session.refresh(sys)

    now = datetime.now(timezone.utc)
    # Малая сумма → владелец ИС; крупная (>10 млн) → правление; просрочен SLA (sla_due в прошлом).
    nc_small = Nonconformity(
        system_id=sys.id, system_name=sys.name, characteristic="Надёжность",
        subcharacteristic="Отказоустойчивость", owner="Иванов", status=STATUS_EVALUATED,
        level="MAJOR", evaluated_ale=500_000, sla_due=now + timedelta(days=10),
    )
    nc_board = Nonconformity(
        system_id=sys.id, system_name=sys.name, characteristic="Защищённость",
        subcharacteristic="Целостность", owner="Петров", status=STATUS_EVALUATED,
        level="CRITICAL", evaluated_ale=15_000_000, sla_due=now - timedelta(days=1),
    )
    # Не должно попасть в очередь — ещё не оценено.
    nc_identified = Nonconformity(
        system_id=sys.id, system_name=sys.name, characteristic="Производительность",
        subcharacteristic="Отклик", owner="Сидоров", status=STATUS_IDENTIFIED, level="MINOR",
    )
    db_session.add_all([nc_small, nc_board, nc_identified])
    await db_session.commit()

    q = await acceptance_queue(db_session)
    assert len(q.items) == 2  # только EVALUATED
    by_ale = {round(i.ale): i for i in q.items}
    assert by_ale[500_000].signer == "Владелец ИС"
    assert by_ale[500_000].overdue is False
    assert by_ale[15_000_000].signer == "Правление/комитет"
    assert by_ale[15_000_000].overdue is True

    signers = {s.signer: s for s in q.by_signer}
    assert signers["Владелец ИС"].count == 1
    assert signers["Правление/комитет"].overdue == 1


async def test_queue_filters_by_system_and_signer(db_session):
    await _set_matrix(db_session)
    sys_a = System(name="ИС-А", criticality_class=CriticalityClass.BUSINESS_CRITICAL)
    sys_b = System(name="ИС-Б", criticality_class=CriticalityClass.BUSINESS_CRITICAL)
    db_session.add_all([sys_a, sys_b])
    await db_session.commit()
    await db_session.refresh(sys_a)
    await db_session.refresh(sys_b)

    db_session.add_all([
        Nonconformity(system_id=sys_a.id, system_name=sys_a.name, characteristic="Надёжность",
                     subcharacteristic="Отказоустойчивость", owner="А", status=STATUS_EVALUATED,
                     level="MAJOR", evaluated_ale=200_000),
        Nonconformity(system_id=sys_b.id, system_name=sys_b.name, characteristic="Надёжность",
                     subcharacteristic="Отказоустойчивость", owner="Б", status=STATUS_EVALUATED,
                     level="MAJOR", evaluated_ale=300_000),
    ])
    await db_session.commit()

    only_a = await acceptance_queue(db_session, system_id=[sys_a.id])
    assert len(only_a.items) == 1 and only_a.items[0].system_name == "ИС-А"

    only_owner_signer = await acceptance_queue(db_session, signer="Владелец ИС")
    assert len(only_owner_signer.items) == 2


async def test_queue_flags_regulatory_veto_from_linked_risk_event(db_session):
    await _set_matrix(db_session)
    sys = System(name="ИС-Вето", criticality_class=CriticalityClass.MISSION_CRITICAL)
    db_session.add(sys)
    await db_session.commit()
    await db_session.refresh(sys)

    risk = RiskEvent(code="RE-VETO-1", title="Регуляторный риск", owner="Риск-менеджер",
                     system_id=sys.id, regulatory=True, max_sle=1_000_000)
    db_session.add(risk)
    await db_session.commit()
    await db_session.refresh(risk)

    db_session.add(Nonconformity(
        system_id=sys.id, system_name=sys.name, characteristic="Защищённость",
        subcharacteristic="Конфиденциальность", owner="Кузнецов", status=STATUS_EVALUATED,
        level="CRITICAL", evaluated_ale=400_000, risk_event_id=risk.id,
    ))
    await db_session.commit()

    q = await acceptance_queue(db_session)
    assert len(q.items) == 1
    assert "regulatory" in q.items[0].vetoes
