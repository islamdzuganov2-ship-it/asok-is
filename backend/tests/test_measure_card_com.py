"""Тесты ТЗ v19 §17 (Пункт 17): карточка поручения, маршрутизация по критичности, Ц_ОМ.

Часть 1 — чистые функции движка (economics.py), без БД. Часть 2 — сервисный слой governance
(обязательная привязка к risk_event, self-decide по порогу) на db_session, по образцу
test_governance.py.
"""
import uuid

from app.modules.econ.economics import (
    measure_ale_risk,
    price_of_inaction_compensating,
    price_of_inaction_eliminating,
    requires_escalation,
)
from app.modules.governance import service
from app.modules.governance.economics_service import (
    _quarter_bounds,
    effect_timeline,
    has_linked_risks,
    portfolio_effect_curve,
    price_history,
    record_daily_price_snapshot,
)
from app.modules.governance.models import STATUS_APPROVED
from app.modules.governance.schemas import ProposalCreate
from app.modules.llm import service as llm_service
from app.modules.llm.service import _systemic_scope_fallback, generate_systemic_scope_note
from app.modules.risk.event_schemas import MeasureLinkIn, RiskEventCreate
from app.modules.risk.event_service import create_event, link_measure
from app.shared.exceptions import ConflictError, ValidationError


def setup_function():
    llm_service._cache.clear()


# ── measure_ale_risk (§17.2) ──

def test_measure_ale_risk_sums_ale_times_share():
    # 1 000 000 × 0.5 + 200 000 × 1.0 = 700 000
    assert measure_ale_risk([(1_000_000.0, 0.5), (200_000.0, 1.0)]) == 700_000.0


def test_measure_ale_risk_empty_is_zero():
    assert measure_ale_risk([]) == 0.0


# ── requires_escalation (§17.2, УК-43/44) ──

def test_requires_escalation_below_threshold_false():
    # 50 000 ниже 10% от аппетита 1 000 000 (=100 000) → не эскалируем
    assert requires_escalation(ale_risk=50_000, risk_appetite=1_000_000, threshold_share=0.10) is False


def test_requires_escalation_above_threshold_true():
    assert requires_escalation(ale_risk=150_000, risk_appetite=1_000_000, threshold_share=0.10) is True


def test_requires_escalation_is_blocking_overrides_threshold():
    # Даже нулевой ale_risk — is_blocking всегда эскалирует (§17.2, УК-44).
    assert requires_escalation(ale_risk=0, risk_appetite=1_000_000, threshold_share=0.10, is_blocking=True) is True


def test_requires_escalation_regulatory_overrides_threshold():
    assert requires_escalation(ale_risk=0, risk_appetite=1_000_000, threshold_share=0.10, regulatory=True) is True


def test_requires_escalation_no_appetite_conservative():
    # Без риск-аппетита для класса ИС — эскалируем консервативно любую меру с деньгами под ней.
    assert requires_escalation(ale_risk=1, risk_appetite=None, threshold_share=0.10) is True
    assert requires_escalation(ale_risk=0, risk_appetite=None, threshold_share=0.10) is False


# ── Ц_ОМ (§17.4, УК-49/50) ──

def test_price_of_inaction_eliminating_is_ale_risk():
    assert price_of_inaction_eliminating(250_000.0) == 250_000.0


def test_price_of_inaction_eliminating_never_negative():
    assert price_of_inaction_eliminating(-100.0) == 0.0


def test_price_of_inaction_compensating_sums_realized_costs():
    # УК-50: другая формула — фактический ущерб по ТС, не доля ALE.
    assert price_of_inaction_compensating([50_000.0, 30_000.0, None]) == 80_000.0


def test_price_of_inaction_compensating_no_incidents_is_zero():
    assert price_of_inaction_compensating([]) == 0.0


# ── Сервисный слой: обязательная привязка к risk_event (§17.2, УК-42) ──

def _new(**kw) -> ProposalCreate:
    base = dict(system_name="АБС Core", characteristic="Надёжность", metric_name="Доступность",
                rationale="Инцидент P1", expectation="Резервирование узлов")
    base.update(kw)
    return ProposalCreate(**base)


async def test_decide_blocks_measure_without_risk_event(db_session):
    p = await service.create(db_session, _new(), "manager")
    try:
        await service.decide(db_session, p, approve=True, comment=None, username="admin")
        assert False, "ожидался ValidationError"
    except ValidationError as exc:
        assert "risk_event" in str(exc) or "рисковому событию" in str(exc)


async def test_decide_allows_process_measure_without_risk_event(db_session):
    p = await service.create(db_session, _new(is_process_measure=True), "manager")
    p = await service.decide(db_session, p, approve=True, comment=None, username="admin")
    assert p.status == STATUS_APPROVED


async def test_decide_allows_measure_linked_to_risk_event(db_session):
    p = await service.create(db_session, _new(), "manager")
    ev = await create_event(db_session, RiskEventCreate(code=f"RE-TEST-{uuid.uuid4().hex[:8]}", title="Риск"), "risk_mgr")
    assert await has_linked_risks(db_session, p.id) is False
    await link_measure(db_session, ev.id, MeasureLinkIn(proposal_id=p.id))
    assert await has_linked_risks(db_session, p.id) is True
    p = await service.decide(db_session, p, approve=True, comment=None, username="admin")
    assert p.status == STATUS_APPROVED


# ── Очередь по приоритету и «нетипичный порядок» (§17.5, УК-52/53) ──

async def test_list_proposals_priority_sets_transient_fields(db_session):
    p = await service.create(db_session, _new(), "manager")
    ev = await create_event(db_session, RiskEventCreate(
        code=f"RE-TEST-{uuid.uuid4().hex[:8]}", title="Риск",
    ), "risk_mgr")
    ev.ale_avg = 1_000_000  # ale_avg — кэш, не входное поле схемы; выставляем напрямую для теста
    await db_session.commit()
    await link_measure(db_session, ev.id, MeasureLinkIn(proposal_id=p.id, ale_reduction_share=0.5))

    rows = await service.list_proposals(db_session, order_by="priority")
    row = next(r for r in rows if r.id == p.id)
    assert row.priority_weight is not None and row.priority_weight > 0
    assert row.priority_money == 500_000.0  # 1 000 000 × 0.5
    assert row.priority_is_atypical is not None


async def test_list_proposals_created_at_order_skips_priority_fields(db_session):
    await service.create(db_session, _new(), "manager")
    rows = await service.list_proposals(db_session, order_by="created_at")
    assert all(getattr(r, "priority_weight", None) is None for r in rows)


# ── generate_systemic_scope_note (§17.3, УК-46) — заземление на детерминированный список ──

def test_systemic_scope_fallback_names_all_indirect_systems():
    text = _systemic_scope_fallback(["АБС Ядро", "Скоринг-движок"])
    assert "АБС Ядро" in text and "Скоринг-движок" in text


def test_systemic_scope_note_none_when_no_indirect_systems():
    assert generate_systemic_scope_note(["Система A"], []) is None


def test_quarter_bounds_covers_expected_month_range():
    import datetime as dt
    assert _quarter_bounds(dt.date(2026, 8, 17)) == (dt.date(2026, 7, 1), dt.date(2026, 9, 30))
    assert _quarter_bounds(dt.date(2026, 1, 5)) == (dt.date(2026, 1, 1), dt.date(2026, 3, 31))
    assert _quarter_bounds(dt.date(2026, 12, 25)) == (dt.date(2026, 10, 1), dt.date(2026, 12, 31))


async def test_record_daily_price_snapshot_is_idempotent_per_day(db_session):
    import datetime as dt
    p = await service.create(db_session, _new(is_process_measure=True), "manager")
    today = dt.date.today()
    await record_daily_price_snapshot(db_session, p.id, today, 100_000.0)
    await record_daily_price_snapshot(db_session, p.id, today, 150_000.0)  # тот же день — UPDATE, не второй ряд

    hist = await price_history(db_session, p.id, period="quarter")
    same_day = [pt for pt in hist.points if pt.date == today]
    assert len(same_day) == 1
    assert same_day[0].price == 150_000.0


async def test_price_history_quarter_averages_points(db_session):
    import datetime as dt
    p = await service.create(db_session, _new(is_process_measure=True), "manager")
    today = dt.date.today()
    start, _ = _quarter_bounds(today)
    d1, d2 = start, start + dt.timedelta(days=1)
    await record_daily_price_snapshot(db_session, p.id, d1, 100_000.0)
    await record_daily_price_snapshot(db_session, p.id, d2, 200_000.0)

    hist = await price_history(db_session, p.id, period="quarter")
    points_in_range = {pt.date: pt.price for pt in hist.points}
    assert points_in_range.get(d1) == 100_000.0
    assert points_in_range.get(d2) == 200_000.0
    assert hist.period_start == start


# ── §17.7 (УК-57): факт по бюджету/трудоёмкости (перерасход) ──

async def test_set_actuals_blocked_before_execution_done(db_session):
    p = await service.create(db_session, _new(is_process_measure=True), "manager")
    p = await service.decide(db_session, p, approve=True, comment=None, username="admin")
    try:
        await service.set_actuals(db_session, p, capex=1000, opex=None, effort_hours=None, user_id=None)
        assert False, "ожидался ConflictError"
    except ConflictError:
        pass


async def test_set_actuals_requires_at_least_one_value(db_session):
    p = await service.create(db_session, _new(is_process_measure=True), "manager")
    p = await service.decide(db_session, p, approve=True, comment=None, username="admin")
    p = await service.set_execution(db_session, p, "DONE", "готово", "manager")
    try:
        await service.set_actuals(db_session, p, capex=None, opex=None, effort_hours=None, user_id=None)
        assert False, "ожидался ValidationError"
    except ValidationError:
        pass


async def test_set_actuals_and_budget_variance(db_session):
    p = await service.create(db_session, _new(is_process_measure=True, characteristic="Надёжность"), "manager")
    p = await service.decide(db_session, p, approve=True, comment=None, username="admin")
    p = await service.set_execution(db_session, p, "DONE", "готово", "manager")

    from app.modules.governance.economics_service import set_measure_economics
    from app.modules.governance.schemas import MeasureEconomicsIn
    p = await set_measure_economics(db_session, p, MeasureEconomicsIn(capex=500_000, opex_per_year=80_000))

    p = await service.set_actuals(db_session, p, capex=650_000, opex=None, effort_hours=12.5, user_id=None)
    variance = service.budget_variance(p)
    assert variance["capex_variance"] == 150_000.0  # перерасход
    assert variance["opex_variance"] is None         # факт по OPEX не вносили — не 0 молча
    assert variance["planned_effort_hours"] is None  # часы плана не проставлялись отдельно
    assert variance["actual_effort_hours"] == 12.5

    # Регресс: budget_variance() отдаёт «сырой» dict напрямую в BudgetVarianceOut через
    # response_model роутера (без промежуточного маппинга) — schema требует proposal_id;
    # его отсутствие в dict не ловится прямым вызовом сервиса, только валидацией схемы.
    from app.modules.governance.schemas import BudgetVarianceOut
    BudgetVarianceOut(**variance)


# ── ТЗ v19 п.15 (УК-37): эффект меры во времени, на реальной Proposal ──

async def test_effect_timeline_not_computable_before_decision(db_session):
    p = await service.create(db_session, _new(is_process_measure=True), "manager")
    result = effect_timeline(p)
    assert result.computable is False
    assert result.proposal_id == p.id


async def test_effect_timeline_computable_after_decision_with_economics(db_session):
    p = await service.create(db_session, _new(is_process_measure=True), "manager")
    p = await service.decide(db_session, p, approve=True, comment=None, username="admin")
    p.capex = 200000
    p.opex_per_year = 20000
    p.implementation_months = 1
    p.delta_ale_cash = 400000
    await db_session.commit()

    result = effect_timeline(p)
    assert result.computable is True
    assert result.start_date == p.decided_at.date()
    assert len(result.points) == 8  # горизонт по умолчанию
    assert result.payback_quarter is not None


async def test_portfolio_effect_curve_excludes_pending_and_uncomputable(db_session):
    # Одобренная мера с решением — учитывается.
    p1 = await service.create(db_session, _new(is_process_measure=True, characteristic="Надёжность"), "manager")
    p1 = await service.decide(db_session, p1, approve=True, comment=None, username="admin")
    p1.capex = 100000
    p1.delta_ale_cash = 200000
    await db_session.commit()

    # Ещё не решена — не должна попасть в кривую (не в выборке status=APPROVED).
    await service.create(db_session, _new(is_process_measure=True, characteristic="Защищённость"), "manager")

    curve = await portfolio_effect_curve(db_session)
    assert curve.measures_included == 1
    assert curve.measures_excluded_no_start_date == 0
    assert len(curve.points) > 0
    # 100000 CAPEX списан в первом квартале, дальше растёт на 50000/квартал (200000/год / 4).
    assert curve.points[0].cumulative == 50000.0 - 100000.0
    assert curve.points[-1].cumulative > curve.points[0].cumulative


async def test_portfolio_effect_curve_sums_across_measures_in_same_quarter(db_session):
    p1 = await service.create(db_session, _new(is_process_measure=True, characteristic="Надёжность"), "manager")
    p1 = await service.decide(db_session, p1, approve=True, comment=None, username="admin")
    p1.capex = 0
    p1.opex_per_year = 0
    p1.implementation_months = 0
    p1.delta_ale_cash = 400000  # 100000/квартал
    await db_session.commit()

    p2 = await service.create(db_session, _new(is_process_measure=True, characteristic="Защищённость"), "manager")
    p2 = await service.decide(db_session, p2, approve=True, comment=None, username="admin")
    p2.capex = 0
    p2.opex_per_year = 0
    p2.implementation_months = 0
    p2.delta_ale_cash = 200000  # 50000/квартал
    await db_session.commit()

    curve = await portfolio_effect_curve(db_session)
    # Обе меры решены «сейчас» — их первый квартал совпадает, суммарный net = 150000.
    first_quarter_net = curve.points[0].net_cash
    assert first_quarter_net == 150000.0


def test_systemic_scope_note_falls_back_when_llm_unavailable(monkeypatch):
    # complete() замокан на None (эквивалент «модель недоступна/ошибка инференса») — в этом
    # окружении ЕСТЬ настоящие .gguf-модели (models/llm/), реальный вызов complete() грузит
    # многогигабайтный файл в память и рискует OOM в тестовом контейнере — юнит-тест не должен
    # зависеть от реальной модели (см. test_executor_brief.py — тот же принцип честного отката).
    monkeypatch.setattr(llm_service, "complete", lambda *a, **kw: None)
    text = generate_systemic_scope_note(["Система A"], ["Система B", "Система C"])
    assert text is not None
    assert "Система B" in text and "Система C" in text
