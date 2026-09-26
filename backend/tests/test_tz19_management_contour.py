"""Тесты ТЗ-19 «Управленческий контур» — задачи, закрытые 26.09.2026.

УК-15/16/17 — журнал уведомлений, события по расписанию, календарные приглашения;
УК-25/26 — типовые ставки и отчёт отклонений; УК-31/32/33 — вес меры, нагрузка, балансировка;
УК-38/18/40 — «В работу» из карточки меры; УК-45 — сверка исполнения со сбоями;
УК-54 — очередь бюджетных заявок; УК-60 — автоэскалация просроченных мер; УК-03 — шкала
прочтения; УК-35а — страж языка записки; УК-41 — оргструктуры в системе нет.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.modules.econ import service as econ
from app.modules.econ.models import (
    BENCHMARK_SUPPORT_RATE,
    ENTERPRISE_PROFILE_ID,
    RATE_SOURCE_MANUAL,
    RATE_SOURCE_REFERENCE,
    EnterpriseProfile,
    MarketBenchmark,
    SupportRate,
)
from app.modules.econ.schemas import FillDefaultRatesIn, SupportRateUpdate
from app.modules.governance import service as gov
from app.modules.governance import executor_load
from app.modules.governance.models import Proposal
from app.modules.governance.schemas import TakeToWorkIn
from app.modules.iam.models import User
from app.modules.incidents import TechIncident
from app.modules.notifications import ical
from app.modules.notifications import service as notif
from app.modules.notifications.models import (
    STATUS_FAILED,
    STATUS_SENT,
    STATUS_UNDELIVERABLE,
    NotificationDelivery,
)
from app.modules.nonconformity.service import auto_escalate_overdue_measures
from app.modules.quality import score_reading
from app.modules.risk import event_service as risk_service
from app.modules.risk.event_schemas import MeasureLinkIn, RiskEventCreate
from app.modules.risk.execution_control import KIND_LINKED, KIND_SIMILAR, execution_mismatches
from app.modules.risk.models import RiskEventIncident
from app.modules.systems.models import CriticalityClass, System
from app.shared.notification_events import (
    EVENT_MEASURE_APPROVED,
    EVENT_MEASURE_ASSIGNED,
    EVENT_MEASURE_CALENDAR,
    EVENT_MEASURE_DUE_SOON,
    EVENT_MEASURE_SLA_ESCALATED,
    EVENT_MEASUREMENT_OVERDUE,
    EVENT_RISK_THRESHOLD_EXCEEDED,
    RECIPIENT_TOP_MANAGEMENT,
    render,
)
from app.shared.ports import NotificationEvent

NOW = datetime.now(timezone.utc)


class _Port:
    def __init__(self, fail_times: int = 0, always_fail: bool = False):
        self.events: list[NotificationEvent] = []
        self.fail_times = fail_times
        self.always_fail = always_fail

    def notify(self, event: NotificationEvent) -> bool:
        self.events.append(event)
        if self.always_fail:
            raise ConnectionError("smtp недоступен")
        if self.fail_times > 0:
            self.fail_times -= 1
            raise ConnectionError("временный сбой")
        return True


async def _user(db, username, full_name=None, email=None, role="EXECUTOR") -> User:
    u = User(username=username, full_name=full_name, email=email, role=role,
             password_hash="x", is_active=True)
    db.add(u)
    await db.flush()
    return u


async def _system(db, name="АБС Core", crit=CriticalityClass.MISSION_CRITICAL, owner=None) -> System:
    s = System(id=uuid.uuid4(), name=name, code=f"S-{uuid.uuid4().hex[:6]}", criticality_class=crit, owner=owner)
    db.add(s)
    await db.flush()
    return s


def _event(recipient="ivan", **kw) -> NotificationEvent:
    base = dict(event_type=EVENT_MEASURE_APPROVED, recipient=recipient, subject="тема", body="текст",
                entity_type="proposal", entity_id="p-1")
    base.update(kw)
    return NotificationEvent(**base)


# ═══════════════════ УК-15/16: журнал отправок ═══════════════════

async def test_dispatch_journals_sent_with_resolved_email(db_session):
    await _user(db_session, "ivan", "Иванов И.И.", "ivan@bank.ru")
    port = _Port()
    row = await notif.dispatch(db_session, _event(recipient="Иванов И.И."), port=port)
    assert row.status == STATUS_SENT and row.address == "ivan@bank.ru" and row.attempts == 1
    assert port.events[0].address == "ivan@bank.ru"      # адрес доходит до канала


async def test_user_without_email_is_undeliverable_but_does_not_block_others(db_session):
    await _user(db_session, "noemail", "Без Почты")
    await _user(db_session, "petr", "Петров П.П.", "petr@bank.ru")
    port = _Port()
    bad = await notif.dispatch(db_session, _event(recipient="Без Почты"), port=port)
    good = await notif.dispatch(db_session, _event(recipient="petr"), port=port)
    ghost = await notif.dispatch(db_session, _event(recipient="Неизвестный"), port=port)
    assert bad.status == STATUS_UNDELIVERABLE and bad.reason == notif.REASON_NO_EMAIL
    assert ghost.status == STATUS_UNDELIVERABLE and ghost.reason == notif.REASON_NOT_FOUND
    assert good.status == STATUS_SENT
    report = await notif.undeliverable_report(db_session)
    assert {r["recipient"] for r in report} == {"Без Почты", "Неизвестный"}
    # Ни одно событие не ушло без записи в журнале.
    assert (await db_session.execute(select(NotificationDelivery))).scalars().all().__len__() == 3


async def test_retries_inline_then_failed_then_scheduled_retry(db_session):
    await _user(db_session, "ivan", email="ivan@bank.ru")
    flaky = _Port(fail_times=1)
    row = await notif.dispatch(db_session, _event(), port=flaky)
    assert row.status == STATUS_SENT and row.attempts == 2       # повтор сразу

    down = _Port(always_fail=True)
    failed = await notif.dispatch(db_session, _event(entity_id="p-2"), port=down)
    assert failed.status == STATUS_FAILED and failed.attempts == notif.MAX_INLINE_ATTEMPTS
    assert "smtp" in failed.reason

    delivered = await notif.retry_failed(db_session, port=_Port())
    assert delivered == 1
    await db_session.refresh(failed)
    assert failed.status == STATUS_SENT and failed.attempts == notif.MAX_INLINE_ATTEMPTS + 1


async def test_top_management_role_expands_to_decision_makers(db_session):
    await _user(db_session, "ceo", email="ceo@bank.ru", role="ADMIN")
    await _user(db_session, "exec", email="exec@bank.ru", role="EXECUTOR")
    row = await notif.dispatch(db_session, _event(recipient=RECIPIENT_TOP_MANAGEMENT), port=_Port())
    assert row.status == STATUS_SENT
    assert "ceo@bank.ru" in row.address and "exec@bank.ru" not in row.address


async def test_dedupe_key_prevents_repeat(db_session):
    first = await notif.dispatch(db_session, _event(), port=_Port(), dedupe_key="k1")
    second = await notif.dispatch(db_session, _event(), port=_Port(), dedupe_key="k1")
    assert first is not None and second is None


def test_templates_render_all_five_uk15_events():
    subject, body = render(EVENT_MEASURE_DUE_SOON, days=3, title="Резервирование", system="АБС", due="01.10.2026")
    assert "3" in subject and "01.10.2026" in body
    with pytest.raises(KeyError):
        render(EVENT_MEASUREMENT_OVERDUE, system="АБС")    # поле шаблона пропущено — ошибка, не пустота
    with pytest.raises(KeyError):
        render("no.such.event")


# ═══════════════════ УК-17: iCalendar ═══════════════════

def test_ics_is_valid_all_day_event_with_folding_and_escaping():
    text = ical.build_measure_event(
        proposal_id="42", summary="Срок меры: резервирование; балансировщик, N+1",
        description="Очень длинное описание " * 10, due=date(2026, 10, 1),
        attendee_email="ivan@bank.ru", attendee_name="Иванов И.И.",
    )
    assert text.startswith("BEGIN:VCALENDAR\r\n") and text.endswith("END:VCALENDAR\r\n")
    assert "METHOD:REQUEST" in text and "DTSTART;VALUE=DATE:20261001" in text
    assert "DTEND;VALUE=DATE:20261002" in text and "UID:measure-42@asok-is" in text
    unfolded = text.replace("\r\n ", "")          # развёртка переноса строк (RFC 5545 §3.1)
    assert "SUMMARY:Срок меры: резервирование\\; балансировщик\\, N+1" in unfolded
    for line in text.split("\r\n"):
        assert len(line.encode("utf-8")) <= 75


# ═══════════════════ УК-15: события по расписанию ═══════════════════

async def test_due_soon_scan_notifies_once_per_due_date(db_session):
    from app.modules.governance.notifications_scan import notify_due_soon

    await _user(db_session, "ivan", "Иванов И.И.", "ivan@bank.ru")
    db_session.add(Proposal(system_name="АБС", owner="Иванов И.И.", status="APPROVED",
                            risk_title="Резервирование", due_on=NOW + timedelta(days=2)))
    db_session.add(Proposal(system_name="АБС", owner="Иванов И.И.", status="APPROVED",
                            risk_title="Далеко", due_on=NOW + timedelta(days=30)))
    await db_session.commit()
    assert await notify_due_soon(db_session, days=3) == 1
    assert await notify_due_soon(db_session, days=3) == 0        # повторный прогон — без дубля
    row = (await db_session.execute(select(NotificationDelivery))).scalars().one()
    assert row.event_type == EVENT_MEASURE_DUE_SOON and "Резервирование" in row.subject


async def test_measurement_overdue_scan(db_session):
    from app.modules.assessment.models import AssessmentPeriod
    from app.modules.assessment.notifications_scan import expected_period, notify_overdue_measurements

    assert expected_period(date(2027, 2, 15)) == "Q4-2026"
    assert expected_period(date(2026, 9, 26)) == "Q2-2026"
    stale = await _system(db_session, "Устаревшая", owner="Иванов И.И.")
    fresh = await _system(db_session, "Свежая", owner="Петров П.П.")
    db_session.add_all([
        AssessmentPeriod(system_id=stale.id, period="Q4-2025", status="COMPLETE"),
        AssessmentPeriod(system_id=fresh.id, period="Q2-2026", status="COMPLETE"),
    ])
    await db_session.commit()
    assert await notify_overdue_measurements(db_session, today=date(2026, 9, 26)) == 1
    row = (await db_session.execute(select(NotificationDelivery))).scalars().one()
    assert row.event_type == EVENT_MEASUREMENT_OVERDUE and row.recipient == "Иванов И.И."


async def test_risk_threshold_notifies_only_on_crossing(db_session):
    s = await _system(db_session, "Шлюз")
    ev = await risk_service.create_event(db_session, RiskEventCreate(
        code="RE-T-1", title="Отказ балансировщика", system_id=s.id, owner="Иванов И.И."), "rm")
    ev.risk_appetite = 100_000
    ev.aro, ev.aro_is_expert, ev.sle_expert = 4, True, 50_000     # ALE 200 000 > аппетит
    await db_session.commit()
    await risk_service.recompute_ale(db_session, ev)
    await risk_service.recompute_ale(db_session, ev)              # уже выше — повторно не шлём
    rows = (await db_session.execute(
        select(NotificationDelivery).where(NotificationDelivery.event_type == EVENT_RISK_THRESHOLD_EXCEEDED)
    )).scalars().all()
    assert len(rows) == 1 and "Отказ балансировщика" in rows[0].subject


# ═══════════════════ УК-60: автоэскалация просроченных мер ═══════════════════

async def test_overdue_measures_escalate_by_differentiated_sla(db_session):
    minor_31 = Proposal(system_name="АБС", status="APPROVED", risk_title="минор 31", due_on=NOW - timedelta(days=31))
    minor_10 = Proposal(system_name="АБС", status="APPROVED", risk_title="минор 10", due_on=NOW - timedelta(days=10))
    crit_4 = Proposal(system_name="АБС", status="APPROVED", risk_title="крит 4", due_on=NOW - timedelta(days=4),
                      is_blocking_override=True)
    done = Proposal(system_name="АБС", status="APPROVED", risk_title="исполнена", execution="DONE",
                    due_on=NOW - timedelta(days=90))
    db_session.add_all([minor_31, minor_10, crit_4, done])
    await db_session.commit()

    assert await auto_escalate_overdue_measures(db_session) == 2
    for p in (minor_31, minor_10, crit_4, done):
        await db_session.refresh(p)
    assert minor_31.escalated and crit_4.escalated
    assert not minor_10.escalated and not done.escalated
    entry = next(h for h in crit_4.history if h["field"] == "autoEscalatedSla")
    assert "SLA 3 дн." in entry["to"] and entry["by"] == "система (SLA)"
    journal = (await db_session.execute(select(NotificationDelivery))).scalars().all()
    assert {r.event_type for r in journal} == {EVENT_MEASURE_SLA_ESCALATED}

    # После решения топа карточка повторно по SLA не поднимается.
    crit_4.escalated = False
    await db_session.commit()
    assert await auto_escalate_overdue_measures(db_session) == 0


# ═══════════════════ УК-25/26: типовые ставки и отклонения ═══════════════════

async def _profile(db, size="LARGE"):
    db.add(EnterpriseProfile(id=ENTERPRISE_PROFILE_ID, size_class=size, industry="Банки"))
    await db.flush()


def _bench(value, line=None, size=None, executor="INTERNAL"):
    return MarketBenchmark(kind=BENCHMARK_SUPPORT_RATE, dimension=executor, company_size_class=size, line=line,
                           value=value, unit="₽/час", source="справочник заказчика", observed_on=date(2026, 6, 30))


async def test_typical_rate_prefers_most_specific(db_session):
    await _profile(db_session)
    db_session.add_all([_bench(3000), _bench(3500, line="L2"), _bench(4200, line="L2", size="LARGE"),
                        _bench(9999, line="L2", size="SMALL")])
    await db_session.commit()
    assert float((await econ.typical_rate(db_session, line="L2", executor_type="INTERNAL")).value) == 4200
    assert float((await econ.typical_rate(db_session, line="L1", executor_type="INTERNAL")).value) == 3000


async def test_fill_defaults_marks_unconfirmed_and_never_overwrites_confirmed(db_session):
    await _profile(db_session)
    db_session.add_all([_bench(2000, line="L1"), _bench(4000, line="L2")])
    await db_session.commit()
    res = await econ.fill_default_rates(db_session, FillDefaultRatesIn())
    assert res.created == 2 and res.skipped_no_reference == ["L3"]
    rates = {r.line: r for r in (await db_session.execute(select(SupportRate))).scalars().all()}
    assert all(r.source == RATE_SOURCE_REFERENCE and r.confirmed_at is None for r in rates.values())

    await econ.confirm_rate(db_session, rates["L1"], "manager")
    # Справочник обновился (смена размера/рынка) — обновляется только НЕподтверждённая ставка.
    for b in (await db_session.execute(select(MarketBenchmark))).scalars().all():
        b.value = float(b.value) * 2
    await db_session.commit()
    res = await econ.fill_default_rates(db_session, FillDefaultRatesIn(refresh=True))
    assert res.updated == 1
    await db_session.refresh(rates["L1"])
    await db_session.refresh(rates["L2"])
    assert float(rates["L1"].rate_per_hour) == 2000 and float(rates["L2"].rate_per_hour) == 8000

    # Правка руками = подтверждение: ставка становится ручной.
    await econ.update_rate(db_session, rates["L2"], SupportRateUpdate(rate_per_hour=5000), "manager")
    assert rates["L2"].source == RATE_SOURCE_MANUAL and rates["L2"].confirmed_by == "manager"


async def test_rate_deviation_report(db_session):
    await _profile(db_session)
    db_session.add(_bench(4000, line="L2"))
    db_session.add_all([
        SupportRate(line="L2", executor_type="INTERNAL", rate_per_hour=6000),   # +50%
        SupportRate(line="L2", executor_type="INTERNAL", rate_per_hour=4400, is_active=True),  # +10% — в пределах
        SupportRate(line="L3", executor_type="VENDOR", rate_per_hour=26000),   # типовой нет
    ])
    await db_session.commit()
    rep = await econ.rate_deviations(db_session, threshold_pct=20)
    assert rep.without_reference == 1
    over = [r for r in rep.rows if r.deviation_pct is not None]
    assert len(over) == 1 and over[0].deviation_pct == 50.0 and "дороже" in over[0].note
    assert any(r.typical_rate is None and "нет типовой" in r.note for r in rep.rows)


# ═══════════════════ УК-31/32/33: вес, нагрузка, балансировка ═══════════════════

async def test_equal_count_different_weight_and_explained(db_session):
    await _system(db_session, "MC-система", CriticalityClass.MISSION_CRITICAL)
    await _system(db_session, "BO-система", CriticalityClass.BUSINESS_OPERATIONAL)
    db_session.add_all([
        Proposal(system_name="MC-система", characteristic="Надёжность", owner="Тяжёлый", status="APPROVED", effort_hours=40),
        Proposal(system_name="BO-система", characteristic="Удобство использования", owner="Лёгкий", status="APPROVED", effort_hours=40),
        Proposal(system_name="BO-система", characteristic="Надёжность", owner="Лёгкий", status="PENDING_APPROVAL"),
        Proposal(system_name="MC-система", characteristic="Надёжность", owner="Тяжёлый", status="APPROVED", effort_hours=5),
    ])
    await db_session.commit()
    out = await executor_load.executor_load(db_session)
    rows = {r.owner: r for r in out.rows}
    assert rows["Тяжёлый"].open_measures == rows["Лёгкий"].open_measures == 2
    assert rows["Тяжёлый"].weighted_load > rows["Лёгкий"].weighted_load
    assert rows["Лёгкий"].without_estimate == 1                 # не ноль молча
    top = rows["Тяжёлый"].measures[0]
    assert "×" in top.weight_explained and "MISSION CRITICAL" in top.weight_explained


async def test_overloaded_gets_rebalance_hint_and_assignment_warning(db_session):
    await _user(db_session, "free", "Свободный С.С.", role="EXECUTOR")
    db_session.add_all([
        Proposal(system_name="АБС", characteristic="Надёжность", owner="Занятой З.З.", status="APPROVED", effort_hours=120),
        Proposal(system_name="АБС", characteristic="Надёжность", owner="Занятой З.З.", status="APPROVED", effort_hours=60),
    ])
    await db_session.commit()
    out = await executor_load.executor_load(db_session)      # норма по умолчанию — 160 ч
    rows = {r.owner: r for r in out.rows}
    assert rows["Занятой З.З."].state == executor_load.STATE_OVERLOADED
    assert rows["Свободный С.С."].state == executor_load.STATE_FREE
    assert out.hints and out.hints[0].from_owner == "Занятой З.З." and out.hints[0].to_owner == "Свободный С.С."

    check = await executor_load.overload_check(db_session, "Свободный С.С.", 200)
    assert check.overloaded and "перегружен" in check.message


# ═══════════════════ УК-38/18/40/17: «В работу» ═══════════════════

async def test_take_to_work_single_action(db_session, monkeypatch):
    import app.modules.llm.service as llm_service
    monkeypatch.setattr(llm_service, "complete", lambda *a, **k: None)   # LLM недоступна — не блокирует
    port = _Port()
    monkeypatch.setattr(gov, "get_notification_port", lambda: port)

    owner = await _user(db_session, "sidorov", "Сидоров К.М.", "sidorov@bank.ru")
    p = Proposal(system_name="АБС", characteristic="Надёжность", status="APPROVED",
                 risk_title="Резервирование балансировщика", rationale="Единая точка отказа",
                 expectation="Резервирование N+1")
    db_session.add(p)
    await db_session.commit()

    p, check = await gov.take_to_work(db_session, p, TakeToWorkIn(
        owner="Сидоров К.М.", due_date="2026-12-15", effort_hours=40), "manager", None)
    assert p.owner == "Сидоров К.М." and p.due_on.date() == date(2026, 12, 15)
    assert p.owner_user_id == owner.id and p.executed_by_user_id == owner.id      # УК-40
    assert float(p.effort_hours) == 40
    assert p.executor_brief and p.rationale == "Единая точка отказа"             # обе формулировки
    assert p.task_ref.startswith("stub://") and p.taken_to_work_at is not None   # УК-18
    assert any(h["field"] == "takenToWork" for h in p.history)
    assert not check.overloaded
    kinds = {e.event_type for e in port.events}
    assert {EVENT_MEASURE_ASSIGNED, EVENT_MEASURE_CALENDAR} <= kinds
    cal = next(e for e in port.events if e.event_type == EVENT_MEASURE_CALENDAR)
    assert cal.attachments and "DTSTART;VALUE=DATE:20261215" in cal.attachments[0].content


async def test_take_to_work_requires_approved_and_keeps_edited_brief(db_session, monkeypatch):
    from app.shared.exceptions import ConflictError

    monkeypatch.setattr(gov, "get_notification_port", lambda: _Port())
    pending = Proposal(system_name="АБС", status="PENDING_APPROVAL")
    approved = Proposal(system_name="АБС", status="APPROVED", executor_brief="старый текст")
    db_session.add_all([pending, approved])
    await db_session.commit()
    with pytest.raises(ConflictError):
        await gov.take_to_work(db_session, pending, TakeToWorkIn(owner="X"), "m", None)
    p, _ = await gov.take_to_work(db_session, approved, TakeToWorkIn(
        owner="X", executor_brief="Шаги: 1) ... 2) ...", send_calendar=False), "m", None)
    assert p.executor_brief == "Шаги: 1) ... 2) ..."                              # правка назначающего (В-51)


# ═══════════════════ УК-45: сверка исполнения со сбоями ═══════════════════

async def test_execution_mismatch_linked_and_similar(db_session):
    s = await _system(db_session, "Платёжный шлюз")
    executed = NOW - timedelta(days=20)
    linked_m = Proposal(system_name=s.name, status="APPROVED", execution="DONE", executed_at=executed,
                        risk_title="Резервирование балансировщика")
    similar_m = Proposal(system_name=s.name, status="APPROVED", execution="DONE", executed_at=executed,
                         risk_title="Устранить переполнение очереди сообщений интеграционной шины",
                         expectation="лимиты скорости очередь сообщений переполнение")
    db_session.add_all([linked_m, similar_m])
    await db_session.flush()
    ev = await risk_service.create_event(db_session, RiskEventCreate(code="RE-M-1", title="Отказ", system_id=s.id), "rm")
    await risk_service.link_measure(db_session, ev.id, MeasureLinkIn(proposal_id=linked_m.id, ale_reduction_share=0.8))
    after = TechIncident(system_id=s.id, system_name=s.name, category="INFRASTRUCTURE", title="Балансировщик упал",
                         occurred_at=NOW - timedelta(days=5))
    before = TechIncident(system_id=s.id, system_name=s.name, category="INFRASTRUCTURE", title="До меры",
                          occurred_at=NOW - timedelta(days=40))
    unlinked = TechIncident(system_id=s.id, system_name=s.name, category="INFRASTRUCTURE",
                            title="Переполнение очереди сообщений шины", root_cause="нет лимитов скорости",
                            occurred_at=NOW - timedelta(days=3))
    db_session.add_all([after, before, unlinked])
    await db_session.flush()
    db_session.add_all([RiskEventIncident(risk_event_id=ev.id, incident_id=after.id),
                        RiskEventIncident(risk_event_id=ev.id, incident_id=before.id)])
    await db_session.commit()

    out = {m.proposal_id: m for m in await execution_mismatches(db_session)}
    assert out[linked_m.id].kind == KIND_LINKED
    assert [i.title for i in out[linked_m.id].incidents] == ["Балансировщик упал"]   # до исполнения — не сигнал
    assert out[similar_m.id].kind == KIND_SIMILAR
    assert out[similar_m.id].incidents[0].title == "Переполнение очереди сообщений шины"


# ═══════════════════ УК-54: очередь бюджетных заявок ═══════════════════

async def test_budget_queue_orders_by_composite_weight_and_budget(db_session):
    s = await _system(db_session, "АБС")
    big_risk = Proposal(system_name=s.name, characteristic="Надёжность", status="PENDING_APPROVAL",
                        risk_title="Крупный риск", capex=300_000)
    small_risk = Proposal(system_name=s.name, characteristic="Надёжность", status="PENDING_APPROVAL",
                          risk_title="Мелкий риск", capex=100_000)
    no_capex = Proposal(system_name=s.name, characteristic="Надёжность", status="PENDING_APPROVAL", risk_title="Без CAPEX")
    db_session.add_all([big_risk, small_risk, no_capex])
    await db_session.flush()
    for code, ale, p in (("RE-B-1", 1_000_000, big_risk), ("RE-B-2", 10_000, small_risk)):
        ev = await risk_service.create_event(db_session, RiskEventCreate(code=code, title=code, system_id=s.id), "rm")
        ev.ale_avg = ale
        await db_session.commit()
        await risk_service.link_measure(db_session, ev.id, MeasureLinkIn(proposal_id=p.id, ale_reduction_share=1.0))

    q = await gov.budget_queue(db_session, budget=350_000)
    assert [r.title for r in q.rows] == ["Крупный риск", "Мелкий риск"]         # без CAPEX — не заявка
    assert [r.within_budget for r in q.rows] == [True, False]
    assert q.rows[1].cumulative_capex == 400_000 and "вес «Надёжность»" in q.rows[0].explained


# ═══════════════════ УК-03, УК-35а, УК-41 ═══════════════════

def test_score_reading_levels_target_and_delta():
    r = score_reading(62.4, previous_pct=58.0, comparable_pct=61.0, target_pct=81.0,
                      compared_systems=3, total_systems=4)
    assert r["level"] == "Выше среднего" and r["delta"] == 3.0 and r["gapToTarget"] == -18.6
    assert score_reading(None)["level"] == "Нет данных"


def test_executive_text_has_no_standard_term():
    from app.modules.llm.service import _JARGON_RE, _management_summary_fallback, _plain_terms

    assert _JARGON_RE.search("просела подхарактеристика «Доступность»")
    assert _plain_terms("просела подхарактеристика") == "просела показатель"
    assert _plain_terms("по трём подхарактеристикам") == "по трём показателям"
    text = _management_summary_fallback(
        problem="Подхарактеристика доступности ниже нормы", ask="Резервирование",
        money_note="224 000 ₽/год", deadline_note="до 01.10.2026", cost_note="разово 150 000 ₽",
        result_note="риск ниже", responsible_note="Иванов И.И.",
    )
    assert not _JARGON_RE.search(text)


def test_no_org_structure_in_system():
    """УК-41: делегирование — вне АСОК. Ни у пользователя, ни у справочника направлений нет
    ссылки «руководитель → подчинённые»; мост в СУЗ — ручная ссылка suz_link."""
    from app.infrastructure.database import Base, import_models

    import_models()
    user_cols = set(Base.metadata.tables["users"].columns.keys())
    assert not user_cols & {"manager_id", "parent_id", "supervisor_id", "reports_to", "department_id"}
    for name, table in Base.metadata.tables.items():
        assert "org" not in name and "subordinate" not in name, name
    assert "suz_link" in Base.metadata.tables["proposals"].columns
