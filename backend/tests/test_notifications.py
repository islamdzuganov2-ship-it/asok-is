"""Тесты порта уведомлений и событийной модели (ТЗ v19 п.6, УК-06).

Три слоя проверяются раздельно: (1) контракт/заглушка сами по себе — не теряют событие,
пишут его в лог; (2) фабрика — пока канал не настроен, отдаёт заглушку; (3) домен governance
эмитит события НУЖНОГО типа НУЖНОМУ получателю на переходах состояния меры, а без получателя
(created_by/owner пуст) — не эмитит ничего (честное отсутствие, не уведомление в никуда).
"""
import app.modules.governance.service as governance_service
from app.infrastructure.integrations.notifications import StubNotificationPort, get_notification_port
from app.modules.governance import service
from app.modules.governance.models import ESCALATION_IGNORE
from app.modules.governance.schemas import ProposalCreate
from app.shared.notification_events import (
    EVENT_MEASURE_APPROVED,
    EVENT_MEASURE_ESCALATED,
    EVENT_MEASURE_ESCALATION_DECIDED,
    EVENT_MEASURE_EXECUTOR_BRIEF_READY,
    EVENT_MEASURE_REJECTED,
    EVENT_TITLES,
)
from app.shared.ports import NotificationEvent, NotificationPort


def _new(**kw) -> ProposalCreate:
    # is_process_measure=True по умолчанию — см. test_governance.py._new (§17.2 не в объёме этих тестов).
    base = dict(system_name="АБС Core", characteristic="Надёжность", metric_name="Доступность",
                rationale="Инцидент", expectation="Резервирование", is_process_measure=True)
    base.update(kw)
    return ProposalCreate(**base)


class _CapturingPort:
    def __init__(self):
        self.events: list[NotificationEvent] = []

    def notify(self, event: NotificationEvent) -> bool:
        self.events.append(event)
        return True


# ─── Порт и заглушка сами по себе ──────────────────────────────────────────────────────

def test_stub_notification_port_satisfies_protocol():
    assert isinstance(StubNotificationPort(), NotificationPort)


def test_stub_notification_port_returns_true_and_does_not_raise():
    port = StubNotificationPort()
    ok = port.notify(NotificationEvent(
        event_type=EVENT_MEASURE_APPROVED, recipient="Иванов И.И.",
        subject="тест", body="тест", entity_type="proposal", entity_id="123",
    ))
    assert ok is True


def test_factory_returns_stub_when_channel_not_configured():
    assert isinstance(get_notification_port(), StubNotificationPort)


def test_all_event_types_have_titles():
    for event_type in (EVENT_MEASURE_APPROVED, EVENT_MEASURE_REJECTED, EVENT_MEASURE_ESCALATED,
                       EVENT_MEASURE_ESCALATION_DECIDED, EVENT_MEASURE_EXECUTOR_BRIEF_READY):
        assert EVENT_TITLES[event_type]  # KeyError на опечатке — тест сам себя ловит


# ─── Эмиссия из governance.service на переходах состояния меры ────────────────────────

async def test_decide_approve_notifies_creator(db_session, monkeypatch):
    fake = _CapturingPort()
    monkeypatch.setattr(governance_service, "get_notification_port", lambda: fake)
    p = await service.create(db_session, _new(), "manager")
    await service.decide(db_session, p, approve=True, comment="ОК", username="admin")
    assert len(fake.events) == 1
    assert fake.events[0].event_type == EVENT_MEASURE_APPROVED
    assert fake.events[0].recipient == "manager"


async def test_decide_reject_emits_rejected_event(db_session, monkeypatch):
    fake = _CapturingPort()
    monkeypatch.setattr(governance_service, "get_notification_port", lambda: fake)
    p = await service.create(db_session, _new(), "manager")
    await service.decide(db_session, p, approve=False, comment=None, username="admin")
    assert fake.events[0].event_type == EVENT_MEASURE_REJECTED


async def test_decide_without_creator_emits_nothing(db_session, monkeypatch):
    """created_by пуст — уведомлять некого; заглушка не должна получить фиктивное событие."""
    fake = _CapturingPort()
    monkeypatch.setattr(governance_service, "get_notification_port", lambda: fake)
    p = await service.create(db_session, _new(), "manager")
    p.created_by = None
    await db_session.commit()
    await service.decide(db_session, p, approve=True, comment=None, username="admin")
    assert fake.events == []


async def test_escalate_notifies_top_management_role(db_session, monkeypatch):
    fake = _CapturingPort()
    monkeypatch.setattr(governance_service, "get_notification_port", lambda: fake)
    p = await service.create(db_session, _new(), "manager")
    await service.escalate(db_session, p, "Просрочено без объяснений", "manager")
    assert fake.events[0].event_type == EVENT_MEASURE_ESCALATED
    assert fake.events[0].recipient == "топ-менеджмент"


async def test_decide_escalation_notifies_creator(db_session, monkeypatch):
    fake = _CapturingPort()
    monkeypatch.setattr(governance_service, "get_notification_port", lambda: fake)
    p = await service.create(db_session, _new(), "manager")
    await service.escalate(db_session, p, "Причина", "manager")
    fake.events.clear()
    await service.decide_escalation(db_session, p, ESCALATION_IGNORE, "Игнорировать", "admin")
    assert fake.events[0].event_type == EVENT_MEASURE_ESCALATION_DECIDED
    assert fake.events[0].recipient == "manager"


async def test_rewrite_for_executor_notifies_owner(db_session, monkeypatch):
    import app.modules.llm.service as llm_service
    monkeypatch.setattr(llm_service, "complete", lambda *a, **k: None)
    fake = _CapturingPort()
    monkeypatch.setattr(governance_service, "get_notification_port", lambda: fake)
    p = await service.create(db_session, _new(owner="Сидоров К.М."), "manager")
    p = await service.decide(db_session, p, approve=True, comment=None, username="admin")
    fake.events.clear()
    await service.rewrite_for_executor(db_session, p, None)
    assert fake.events[0].event_type == EVENT_MEASURE_EXECUTOR_BRIEF_READY
    assert fake.events[0].recipient == "Сидоров К.М."


async def test_rewrite_for_executor_without_owner_emits_nothing(db_session, monkeypatch):
    import app.modules.llm.service as llm_service
    monkeypatch.setattr(llm_service, "complete", lambda *a, **k: None)
    fake = _CapturingPort()
    monkeypatch.setattr(governance_service, "get_notification_port", lambda: fake)
    p = await service.create(db_session, _new(), "manager")
    p = await service.decide(db_session, p, approve=True, comment=None, username="admin")
    fake.events.clear()
    await service.rewrite_for_executor(db_session, p, None)
    assert fake.events == []
