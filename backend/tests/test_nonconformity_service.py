"""Тесты домена nonconformity (BL-007, RE-14) — инварианты замыкания контура (§3.3).

Проверяется машина состояний: обязательный владелец, порядок статусов, ACCEPT требует подписи,
«Верифицировано» ставит НЕ тот, кто оценивал/исполнял (SoD), воронка замкнутости.
"""
import uuid

import pytest

from app.modules.econ import service as econ
from app.modules.governance.models import Proposal
from app.modules.nonconformity import service
from app.modules.nonconformity.models import (
    STATUS_DECIDED,
    STATUS_EVALUATED,
    STATUS_EXECUTED,
    STATUS_IDENTIFIED,
    STATUS_VERIFIED,
)
from app.modules.nonconformity.schemas import DecideIn, NonconformityCreate
from app.shared.exceptions import ConflictError, NotFoundError, ValidationError


def _nc(owner="Иванов", **kw) -> NonconformityCreate:
    base = dict(system_name="АБС Core", characteristic="Надёжность",
                subcharacteristic="Отказоустойчивость", owner=owner, level="MAJOR")
    base.update(kw)
    return NonconformityCreate(**base)


async def _proposal(db) -> Proposal:
    p = Proposal(system_name="АБС Core", status="APPROVED")
    db.add(p)
    await db.commit()
    await db.refresh(p)
    return p


# ── Создание ──

async def test_create_requires_owner_and_valid_level(db_session):
    with pytest.raises(ValidationError):
        await service.create(db_session, _nc(owner="  "), "analyst")
    with pytest.raises(ValidationError):
        await service.create(db_session, _nc(level="BOGUS"), "analyst")
    nc = await service.create(db_session, _nc(), "analyst")
    assert nc.status == STATUS_IDENTIFIED and nc.owner == "Иванов"


# ── Полный жизненный цикл до «Верифицировано» ──

async def test_full_lifecycle_to_verified(db_session):
    nc = await service.create(db_session, _nc(owner="Иванов"), "analyst")
    nc = await service.evaluate(db_session, nc, 3_000_000, "Иванов")
    assert nc.status == STATUS_EVALUATED and float(nc.evaluated_ale) == 3_000_000 and nc.sla_due is not None

    nc = await service.decide(db_session, nc, DecideIn(verdict="ELIMINATE"), "cto")
    assert nc.status == STATUS_DECIDED and nc.decision_verdict == "ELIMINATE"

    prop = await _proposal(db_session)
    nc = await service.assign_measure(db_session, nc, prop.id, "manager")
    nc = await service.start(db_session, nc, "manager")
    nc = await service.execute(db_session, nc, "Петров", "меры внедрены")
    assert nc.status == STATUS_EXECUTED and nc.executed_by == "Петров"

    nc = await service.verify(db_session, nc, "Сидоров", delta_score_confirmed=12.5)
    assert nc.status == STATUS_VERIFIED and nc.verified_by == "Сидоров"
    assert float(nc.delta_score_confirmed) == 12.5
    # История зафиксировала все переходы.
    actions = [h["action"] for h in nc.history]
    assert actions == ["evaluate", "decide:ELIMINATE", "assign_measure", "start", "execute", "verify"]


# ── SoD: кто оценивал/исполнял — не верифицирует ──

async def test_verify_blocked_for_owner_or_executor(db_session):
    nc = await service.create(db_session, _nc(owner="Иванов"), "analyst")
    nc = await service.evaluate(db_session, nc, 1_000_000, "Иванов")
    nc = await service.decide(db_session, nc, DecideIn(verdict="COMPENSATE"), "cto")
    prop = await _proposal(db_session)
    nc = await service.assign_measure(db_session, nc, prop.id, "manager")
    nc = await service.start(db_session, nc, "manager")
    nc = await service.execute(db_session, nc, "Петров", None)
    # Владелец (оценивал) не может верифицировать.
    with pytest.raises(ValidationError):
        await service.verify(db_session, nc, "Иванов", None)
    # Исполнитель тоже не может.
    with pytest.raises(ValidationError):
        await service.verify(db_session, nc, "Петров", None)


# ── Ветка «принять риск» ──

async def test_accept_requires_signature_and_sets_acceptance_level(db_session):
    await econ.seed_econ_defaults(db_session)  # матрица акцепта
    nc = await service.create(db_session, _nc(), "analyst")
    nc = await service.evaluate(db_session, nc, 500_000, "Иванов")  # ≤1 млн → владелец ИС
    # Без подписи принять нельзя.
    with pytest.raises(ValidationError):
        await service.decide(db_session, nc, DecideIn(verdict="ACCEPT"), "cto")
    nc = await service.decide(db_session, nc, DecideIn(verdict="ACCEPT", signed_by="Владелец ИС Иванов"), "cto")
    assert nc.status == STATUS_DECIDED and nc.decision_verdict == "ACCEPT"
    assert nc.acceptance_level == "Владелец ИС" and nc.review_date is not None
    # У принятого риска меры нет — назначить нельзя.
    prop = await _proposal(db_session)
    with pytest.raises(ConflictError):
        await service.assign_measure(db_session, nc, prop.id, "manager")


# ── Инварианты переходов ──

async def test_invalid_transitions_are_blocked(db_session):
    nc = await service.create(db_session, _nc(), "analyst")
    # Решение до оценки — нельзя.
    with pytest.raises(ConflictError):
        await service.decide(db_session, nc, DecideIn(verdict="ELIMINATE"), "cto")
    nc = await service.evaluate(db_session, nc, 100_000, "Иванов")
    # Повторная оценка — нельзя.
    with pytest.raises(ConflictError):
        await service.evaluate(db_session, nc, 200_000, "Иванов")


async def test_assign_measure_unknown_proposal_404(db_session):
    nc = await service.create(db_session, _nc(), "analyst")
    nc = await service.evaluate(db_session, nc, 100_000, "Иванов")
    nc = await service.decide(db_session, nc, DecideIn(verdict="ELIMINATE"), "cto")
    with pytest.raises(NotFoundError):
        await service.assign_measure(db_session, nc, uuid.uuid4(), "manager")


# ── Воронка замкнутости ──

async def test_closure_funnel_counts_and_rate(db_session):
    # Два несоответствия: одно доводим до «Верифицировано», второе остаётся на «Выявлено».
    a = await service.create(db_session, _nc(owner="Иванов"), "analyst")
    await service.create(db_session, _nc(owner="Иванов"), "analyst")
    a = await service.evaluate(db_session, a, 100_000, "Иванов")
    a = await service.decide(db_session, a, DecideIn(verdict="ELIMINATE"), "cto")
    prop = await _proposal(db_session)
    a = await service.assign_measure(db_session, a, prop.id, "manager")
    a = await service.start(db_session, a, "manager")
    a = await service.execute(db_session, a, "Петров", None)
    await service.verify(db_session, a, "Сидоров", None)

    funnel = await service.closure_funnel(db_session)
    assert funnel.total == 2 and funnel.verified == 1 and funnel.closure_rate == 50.0
    assert len(funnel.stages) == 7
