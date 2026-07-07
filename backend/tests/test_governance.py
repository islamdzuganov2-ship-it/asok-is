"""Тесты домена governance (T-10): инварианты состояния меры (SoD-петля v12) на сервисном слое.

Ролевые проверки (require_role) — тонкий слой FastAPI поверх этих операций; здесь проверяется
БИЗНЕС-логика статусов: решение только по ожидающей, исполнение только по одобренной, обязательные
комментарии, история правок, цикл эскалации.
"""
import pytest

from app.modules.governance import service
from app.modules.governance.models import STATUS_APPROVED, STATUS_PENDING, STATUS_REJECTED
from app.modules.governance.schemas import EditIn, MetaIn, ProposalCreate
from app.shared.exceptions import ConflictError, NotFoundError, ValidationError


def _new(system="АБС Core", **kw) -> ProposalCreate:
    base = dict(system_name=system, characteristic="Надёжность", metric_name="Доступность",
                rationale="Инцидент P1", expectation="Резервирование узлов")
    base.update(kw)
    return ProposalCreate(**base)


async def test_create_sets_pending_and_author(db_session):
    p = await service.create(db_session, _new(), "manager")
    assert p.status == STATUS_PENDING
    assert p.created_by == "manager"
    assert p.system_name == "АБС Core"


async def test_list_filters_by_system_and_demo(db_session):
    await service.create(db_session, _new(system="АБС Core"), "m")
    await service.create(db_session, _new(system="CRM ОПК", is_demo=True), "m")
    assert len(await service.list_proposals(db_session)) == 2
    assert len(await service.list_proposals(db_session, system="АБС Core")) == 1
    assert len(await service.list_proposals(db_session, include_demo=False)) == 1  # демо скрыта


async def test_decide_approves_pending_then_blocks_double(db_session):
    p = await service.create(db_session, _new(), "manager")
    p = await service.decide(db_session, p, approve=True, comment="Согласовано", username="admin")
    assert p.status == STATUS_APPROVED
    assert p.decided_by == "admin" and p.decided_at is not None
    # Повторное решение по уже решённой мере запрещено (SoD-инвариант состояния).
    with pytest.raises(ConflictError):
        await service.decide(db_session, p, approve=False, comment=None, username="admin")


async def test_reject_sets_status(db_session):
    p = await service.create(db_session, _new(), "manager")
    p = await service.decide(db_session, p, approve=False, comment="Нет ресурса", username="admin")
    assert p.status == STATUS_REJECTED


async def test_execution_requires_approved_and_comment(db_session):
    p = await service.create(db_session, _new(), "manager")
    # Пока мера не одобрена — исполнение отметить нельзя.
    with pytest.raises(ConflictError):
        await service.set_execution(db_session, p, "DONE", "готово", "manager")
    p = await service.decide(db_session, p, approve=True, comment=None, username="admin")
    # Комментарий об исполнении обязателен.
    with pytest.raises(ValidationError):
        await service.set_execution(db_session, p, "DONE", "", "manager")
    p = await service.set_execution(db_session, p, "DONE", "Узлы зарезервированы", "manager")
    assert p.execution == "DONE" and p.executed_by == "manager"


async def test_edit_writes_history(db_session):
    p = await service.create(db_session, _new(), "manager")
    p = await service.edit(db_session, p, EditIn(rationale="Уточнённое обоснование", owner="Иванов И.И."), "admin")
    assert p.rationale == "Уточнённое обоснование"
    assert p.history and len(p.history) == 2
    fields = {h["field"] for h in p.history}
    assert fields == {"rationale", "owner"}  # camelCase-имена полей
    rec = next(h for h in p.history if h["field"] == "rationale")
    assert rec["by"] == "admin" and rec["to"] == "Уточнённое обоснование"


async def test_update_meta_only_before_decision(db_session):
    p = await service.create(db_session, _new(), "manager")
    p = await service.update_meta(db_session, p, MetaIn(owner="Петров П.П.", due_date="2026-09-01"), "admin")
    assert p.owner == "Петров П.П."
    await service.decide(db_session, p, approve=True, comment=None, username="admin")
    with pytest.raises(ConflictError):
        await service.update_meta(db_session, p, MetaIn(owner="Сидоров"), "admin")


async def test_escalation_cycle(db_session):
    p = await service.create(db_session, _new(), "manager")
    await service.decide(db_session, p, approve=True, comment=None, username="admin")
    # Решение по эскалации без активной эскалации — конфликт.
    with pytest.raises(ConflictError):
        await service.decide_escalation(db_session, p, "IGNORE", "—", "admin")
    p = await service.escalate(db_session, p, "Срыв срока", "manager")
    assert p.escalated is True and p.escalation_reason == "Срыв срока"
    p = await service.decide_escalation(db_session, p, "REQUEST_MEASURES", "Выделить ресурс", "admin")
    assert p.escalation_decision == "REQUEST_MEASURES" and p.escalation_decided_by == "admin"
    p = await service.resolve_escalation(db_session, p)
    assert p.escalated is False


async def test_get_or_404(db_session):
    import uuid
    with pytest.raises(NotFoundError):
        await service.get_or_404(db_session, uuid.uuid4())
