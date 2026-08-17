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
from app.modules.governance.economics_service import has_linked_risks
from app.modules.governance.models import STATUS_APPROVED
from app.modules.governance.schemas import ProposalCreate
from app.modules.risk.event_schemas import MeasureLinkIn, RiskEventCreate
from app.modules.risk.event_service import create_event, link_measure
from app.shared.exceptions import ValidationError


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
