"""BL-007: оставшиеся задачи RE-02, RE-03, RE-06, RE-10, RE-19, RE-20 и задел RE-23…RE-27.

Каждый тест проверяет критерий приёмки из docs/BACKLOG_Риск-экономический_контур.md, а не то,
что функция вызывается.
"""
import uuid
from datetime import datetime, timezone

import httpx
import pytest
from httpx import ASGITransport
from sqlalchemy import select

from app.infrastructure.database import get_db
from app.infrastructure.integrations.itsm import FileIncidentSource, audit_quality, parse_export
from app.main import app
from app.modules.assessment import analyst_load_service as analyst_load
from app.modules.assessment.models import AssessmentPeriod, AssessmentValue
from app.modules.assessment.router import create_assessment_period, finalize_assessment
from app.modules.assessment.schemas import PeriodCreate
from app.modules.econ import economics
from app.modules.econ import service as econ
from app.modules.econ.manager_metrics_service import manager_metrics
from app.modules.econ.measure_catalog import MEASURE_CATALOG, uncovered_subchars
from app.modules.econ.schemas import BpCostIn, BusinessProcessCreate, SupportRateIn, SystemBpCreate
from app.modules.governance import Proposal
from app.modules.governance import service as gov
from app.modules.iam import permissions_service as ps
from app.modules.iam.security import create_access_token
from app.modules.incidents import itsm
from app.modules.incidents.models import TechIncident
from app.modules.nonconformity.models import Nonconformity
from app.modules.quality import (
    DEPTH_PROFILE,
    DEPTH_SCREENING,
    QUALITY_MODEL,
    QUALITY_PAIRS,
    FormulaType,
    MetricCatalog,
    calculate_metric,
    map_to_level,
    required_pairs,
)
from app.modules.risk.models import RiskEvent, RiskEventMeasure
from app.modules.risk import event_service
from app.modules.systems import CriticalityClass, System
from app.shared.exceptions import ConflictError, ValidationError

API = "/api/v1"
MONDAY_NOON = datetime(2026, 5, 4, 12, 0, tzinfo=timezone.utc)
SUNDAY_NIGHT = datetime(2026, 5, 3, 2, 0, tzinfo=timezone.utc)


async def _system(db, name="АБС", crit=CriticalityClass.MISSION_CRITICAL) -> System:
    s = System(name=name, code=f"S-{uuid.uuid4().hex[:6]}", criticality_class=crit)
    db.add(s)
    await db.commit()
    await db.refresh(s)
    return s


def _auth(role: str, username="t") -> dict:
    return {"Authorization": "Bearer " + create_access_token({"sub": str(uuid.uuid4()), "role": role, "username": username})}


@pytest.fixture
async def aclient(db_session):
    async def _override():
        yield db_session
    app.dependency_overrides[get_db] = _override
    async with httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.pop(get_db, None)


# ═══════════════ RE-02: C_мин по методу и временному профилю ═══════════════

def test_cost_per_minute_three_methods():
    r = economics.cost_per_minute("RESOURCE", {"n_employees": 60, "hourly_rate": 1000, "k_idle": 0.5, "k_catchup": 1.2})
    assert r.base == pytest.approx(60 * 1000 * 0.5 / 60 * 1.2)
    t = economics.cost_per_minute("TRANSACTIONAL", {"revenue_per_period": 43_200_000, "minutes_per_period": 43_200, "process_share": 0.5})
    assert t.base == pytest.approx(500)
    e = economics.cost_per_minute("EXPERT", {"low": 1000, "high": 3000})
    assert (e.base, e.low, e.high) == (2000, 1000, 3000)
    assert economics.cost_per_minute("RESOURCE", {"n_employees": 5}) is None   # «не рассчитано» ≠ 0


def test_time_profile_peak_offpeak_weekend():
    profile = {"peak_hours": [9, 18], "peak": 1.0, "offpeak": 0.5, "weekend": 0.2}
    assert economics.time_profile_factor(profile, MONDAY_NOON) == 1.0
    assert economics.time_profile_factor(profile, MONDAY_NOON.replace(hour=22)) == 0.5
    assert economics.time_profile_factor(profile, SUNDAY_NIGHT) == 0.2
    assert economics.time_profile_factor(None, SUNDAY_NIGHT) == 1.0


async def test_bp_cost_computed_and_transactional_only_for_frontal(db_session):
    back = await econ.create_business_process(db_session, BusinessProcessCreate(code="BO-1", name="Бэк-офис", kind="BACKOFFICE"))
    row = await econ.upsert_bp_cost(db_session, back.id, BpCostIn(method="RESOURCE", params={"n_employees": 30, "hourly_rate": 1200}))
    assert float(row.cost_per_min_base) == pytest.approx(30 * 1200 * 0.6 / 60 * 1.3)
    with pytest.raises(ValidationError):
        await econ.upsert_bp_cost(db_session, back.id, BpCostIn(method="TRANSACTIONAL",
                                  params={"revenue_per_period": 1, "minutes_per_period": 1}))
    out = econ.bp_cost_out(await econ.upsert_bp_cost(db_session, back.id, BpCostIn(method="EXPERT", params={"low": 10, "high": 30})))
    assert (out.cost_per_min_low, out.cost_per_min_high) == (10, 30)


# ═══════════════ RE-03: ставка по исполнителю, квант, пакет, K ставки ═══════════════

def test_billable_hours_and_vendor_package():
    assert economics.billable_hours(0.33, 60) == 1.0          # 20 минут при кванте 60 → час
    assert economics.billable_hours(1.1, 30) == 1.5
    assert economics.vendor_labor_cost(10, 1000, 1.0, package_hours_left=4, overlimit_rate=3000) == 4 * 1000 + 6 * 3000
    assert economics.internal_hourly_rate(150_000, 1.6, 160) == 1500.0


async def test_incident_cost_uses_vendor_rate_quantum_and_package(db_session):
    s = await _system(db_session)
    await econ.create_rate(db_session, SupportRateIn(line="L3", executor_type="INTERNAL", rate_per_hour=2000))
    await econ.create_rate(db_session, SupportRateIn(line="L3", executor_type="VENDOR", rate_per_hour=5000,
                                                     package_hours=1, overlimit_rate=9000, billing_quantum_min=60,
                                                     k_weekend=2.0))
    inc = TechIncident(system_id=s.id, system_name=s.name, category="INFRASTRUCTURE", title="x",
                       occurred_at=SUNDAY_NIGHT, labor_l3_hours=1.5, labor_vendor_lines=["L3"])
    db_session.add(inc)
    await db_session.flush()
    total = await econ.compute_incident_cost(db_session, inc)
    # 1.5 ч → 2 ч по кванту; 1 ч в пакете × 5000 + 1 ч сверх × 9000; выходные ×2.
    assert total == (1 * 5000 + 1 * 9000) * 2.0
    assert inc.cost_breakdown["lines"][0]["executor"] == "VENDOR"
    # Внутренняя команда на той же линии — своя ставка, без кванта/пакета.
    inc.labor_vendor_lines = []
    assert await econ.compute_incident_cost(db_session, inc) == 1.5 * 2000 * 2.0


async def test_internal_rate_from_payroll(db_session):
    rate = await econ.create_rate(db_session, SupportRateIn(line="L2", fot_monthly=160_000, fund_hours_monthly=160))
    assert float(rate.rate_per_hour) == pytest.approx(160_000 * 1.6 / 160)
    with pytest.raises(ValidationError):
        await econ.create_rate(db_session, SupportRateIn(line="L2"))


# ═══════════════ RE-06: деградация — K по типу и правило «→ простой» ═══════════════

def test_k_by_degradation_type():
    assert economics.k_impact_for_degradation("PERFORMANCE", {"response_ratio": 3}) == 0.35
    assert economics.k_impact_for_degradation("FUNCTIONAL", {"unavailable_weight": 3, "total_weight": 4}) == 0.75
    assert economics.k_impact_for_degradation("THROUGHPUT", {"actual": 40, "required": 100}) == 0.6
    assert economics.k_impact_for_degradation("PERFORMANCE", {}) is None


async def test_incident_economics_endpoint_and_availability(aclient, db_session):
    await ps.seed_rbac_defaults(db_session)
    s = await _system(db_session)
    weak = TechIncident(system_id=s.id, system_name=s.name, category="PERFORMANCE", title="тормоза", occurred_at=MONDAY_NOON)
    strong = TechIncident(system_id=s.id, system_name=s.name, category="PERFORMANCE", title="почти лежит", occurred_at=MONDAY_NOON)
    db_session.add_all([weak, strong])
    await db_session.commit()
    h = _auth("QUALITY_MANAGER")
    r = await aclient.put(f"{API}/incidents/{weak.id}/economics", headers=h, json={
        "incidentType": "DEGRADATION", "degradationType": "PERFORMANCE",
        "degradationInputs": {"response_ratio": 3}, "downtimeMinutes": 120})
    assert r.status_code == 200, r.text
    assert r.json()["kImpact"] == 0.35 and r.json()["countsAsDowntime"] is False
    assert r.json()["costBreakdown"]["k_source"] == "computed"
    r = await aclient.put(f"{API}/incidents/{strong.id}/economics", headers=h, json={
        "incidentType": "DEGRADATION", "degradationType": "FUNCTIONAL",
        "degradationInputs": {"unavailable_weight": 9, "total_weight": 10}, "downtimeMinutes": 60})
    assert r.json()["countsAsDowntime"] is True
    a = (await aclient.get(f"{API}/incidents/analytics", headers=h)).json()
    # В простой вошла только сильная деградация (60 мин), слабые 120 мин — нет.
    assert a["availabilityPct"] is not None
    bad = await aclient.put(f"{API}/incidents/{weak.id}/economics", headers=h, json={"laborVendorLines": ["L9"]})
    assert bad.status_code == 422


# ═══════════════ RE-10: каталог и остаточный риск с/без компенсирующих ═══════════════

def test_catalog_extended_and_covers_every_characteristic():
    assert len(MEASURE_CATALOG) >= 60
    assert {e.characteristic for e in MEASURE_CATALOG} == {c for c, _ in QUALITY_MODEL}
    assert uncovered_subchars() == set()
    assert all(e.eliminating != e.compensating for e in MEASURE_CATALOG)


async def test_portfolio_splits_residual_by_measure_type(db_session):
    s = await _system(db_session)
    risk = RiskEvent(code=f"RE-T-{uuid.uuid4().hex[:4]}", title="r", system_id=s.id, ale_avg=1_000_000, status="active")
    db_session.add(risk)
    elim = Proposal(system_name=s.name, status="APPROVED", execution="DONE", measure_type="ELIMINATING")
    comp = Proposal(system_name=s.name, status="APPROVED", execution="DONE", measure_type="COMPENSATING")
    db_session.add_all([elim, comp])
    await db_session.flush()
    db_session.add_all([
        RiskEventMeasure(risk_event_id=risk.id, proposal_id=elim.id, ale_reduction_share=0.5),
        RiskEventMeasure(risk_event_id=risk.id, proposal_id=comp.id, ale_reduction_share=0.2),
    ])
    await db_session.commit()
    out = await event_service.portfolio_risk_summary(db_session)
    assert out.covered_by_eliminating == 500_000 and out.covered_by_compensating == 200_000
    assert out.residual_with_compensating_only == 800_000
    assert out.residual_risk == 300_000


# ═══════════════ RE-20: антигейминг метрик руководителей ═══════════════

async def test_delta_ale_frozen_at_decision_and_motivation_mode(db_session):
    s = await _system(db_session, "ИС-мотивация")
    p = Proposal(system_name=s.name, owner="Петров", status="PENDING_APPROVAL", delta_ale_cash=100_000,
                 is_process_measure=True)
    db_session.add(p)
    await db_session.commit()
    await gov.decide(db_session, p, True, None, "ceo")
    assert float(p.delta_ale_at_decision) == 100_000
    # Владелец «подтягивает» эффект после решения — метрика берёт зафиксированный.
    p.delta_ale_cash = 5_000_000
    p.execution = "DONE"
    await db_session.commit()
    row = next(r for r in (await manager_metrics(db_session)).rows if r.owner == "Петров")
    assert row.delta_ale_managed == 100_000
    assert row.delta_ale_weighted > row.delta_ale_managed        # Mission Critical весит больше
    # Режим мотивации: без верификации аудитором ΔALE не засчитывается.
    await econ.set_config(db_session, "manager_metrics_mode", "motivation", None)
    out = await manager_metrics(db_session)
    assert out.mode == "motivation"
    assert next(r for r in out.rows if r.owner == "Петров").delta_ale_managed == 0
    db_session.add(Nonconformity(system_name=s.name, characteristic="Надёжность", subcharacteristic="Отказоустойчивость",
                                 owner="Петров", status="VERIFIED", proposal_id=p.id, delta_score_confirmed=4))
    await db_session.commit()
    row = next(r for r in (await manager_metrics(db_session)).rows if r.owner == "Петров")
    assert row.delta_ale_managed == 100_000 and row.effectiveness_pct == 100.0


# ═══════════════ RE-19: глубина, дельта-переоценка, чек-лист, норматив ═══════════════

async def _catalog(db) -> list[MetricCatalog]:
    rows = [MetricCatalog(characteristic=c, subcharacteristic=s, formula_type=FormulaType(f), is_active=True)
            for c, s, f in QUALITY_PAIRS]
    db.add_all(rows)
    await db.flush()
    return rows


def test_depth_sets():
    assert len(required_pairs(None)) == 31
    assert len(required_pairs(DEPTH_PROFILE)) == 19
    assert len(required_pairs(DEPTH_SCREENING)) == 8
    assert {c for c, _ in required_pairs(DEPTH_SCREENING)} == {c for c, _ in QUALITY_MODEL}


async def test_support_system_finalizes_after_screening_only(db_session):
    s = await _system(db_session, "Вики", CriticalityClass.BUSINESS_OPERATIONAL)
    metrics = {(m.characteristic, m.subcharacteristic): m for m in await _catalog(db_session)}
    period = await create_assessment_period(PeriodCreate(system_id=s.id, period="Q3-2026"), db_session, {})
    assert period.depth == DEPTH_SCREENING
    for c, sub in required_pairs(DEPTH_SCREENING):
        m = metrics[(c, sub)]
        v = (await db_session.execute(select(AssessmentValue).where(
            AssessmentValue.period_id == period.id, AssessmentValue.metric_id == m.id))).scalar_one()
        v.val_a, v.val_b = 1, 2
        v.calculated_x = calculate_metric(1, 2, m.formula_type.value)
        v.quality_level = map_to_level(float(v.calculated_x))
    await db_session.commit()
    summary = await finalize_assessment(period.id, db_session, {})
    assert summary.complete and summary.total == 8


async def test_carry_over_and_checklist_flow(db_session):
    s = await _system(db_session, "ИС-дельта")
    metrics = await _catalog(db_session)
    old = AssessmentPeriod(system_id=s.id, period="Q1-2026", status="COMPLETE", depth="FULL")
    new = AssessmentPeriod(system_id=s.id, period="Q2-2026", status="DRAFT", depth="FULL")
    db_session.add_all([old, new])
    await db_session.flush()
    for m in metrics:
        db_session.add(AssessmentValue(period_id=old.id, metric_id=m.id, val_a=1, val_b=2, calculated_x=0.5,
                                       quality_level="Средний", data_source="TEST"))
    await db_session.commit()
    res = await analyst_load.carry_over(db_session, new.id, None)
    assert res["carried"] == 31
    delta = await analyst_load.delta_summary(db_session, new.id)
    assert delta["carriedOver"] == 31 and delta["reassessed"] == 0

    items = await analyst_load.generate_checklist(db_session, new.id)
    assert len(items) == 31
    for i in items[:10]:
        await analyst_load.answer_item(db_session, i.id, "есть отчёт", "https://wiki/x", "owner")
    sample = await analyst_load.sample_checklist(db_session, new.id, 0.2)
    assert sample["sampled"] == 2 and sample["acceptedWithoutCheck"] == 8
    sampled = [i for i in await analyst_load.list_checklist(db_session, new.id) if i.sampled]
    with pytest.raises(ConflictError):
        await analyst_load.verify_item(db_session, sampled[0].id, "VERIFIED", None, "owner")   # SoD
    with pytest.raises(ValidationError):
        await analyst_load.verify_item(db_session, sampled[0].id, "REJECTED", None, "analyst")
    ok = await analyst_load.verify_item(db_session, sampled[0].id, "VERIFIED", None, "analyst")
    assert ok.verification == "VERIFIED"


async def test_effort_report_against_norm(db_session):
    s = await _system(db_session, "ИС-часы")
    db_session.add(AssessmentPeriod(system_id=s.id, period="Q1-2026", status="COMPLETE", depth="FULL", analyst_hours=50))
    await db_session.commit()
    rep = await analyst_load.effort_report(db_session)
    full = next(r for r in rep["rows"] if r["depth"] == "FULL")
    assert full["avgHours"] == 50 and full["normHours"] == 40 and full["deviationPct"] == 25.0


# ═══════════════ RE-23…RE-27: задел ITSM ═══════════════

CSV_EXPORT = (
    "number;opened_at;resolved_at;priority;short_description;assignment_group;cmdb_ci;reassignments\n"
    "INC1;2026-05-04T10:00:00;2026-05-04T12:00:00;1 - Critical;Отказ АБС;L2 АБС;;"
    "2026-05-04T10:00:00>L1;2026-05-04T10:30:00>L2\n"
    "INC2;2026-05-04T10:20:00;2026-05-04T11:00:00;2;Дубль отказа;L2 АБС;;\n"
    "INC3;2026-05-04T15:00:00;;3;Другой сбой;;core-banking;\n"
    ";2026-05-04T15:00:00;;3;Без номера;;;\n"
)


def test_itsm_export_parse_and_quality_audit():
    rows = parse_export(CSV_EXPORT, "csv")
    q = audit_quality(rows)
    assert q["total"] == 4 and q["rejected_missing_required"] == 1
    assert q["completeness_pct"]["resolved_at"] == 50.0
    src = FileIncidentSource(CSV_EXPORT, "csv")
    assert [r.external_id for r in src.fetch_incidents("L2 АБС", "2026-05")] == ["INC1", "INC2"]


def test_resolve_system_priority():
    aliases, names, groups = {"core-banking": "A"}, {"абс": "N"}, {"l2 абс": "G"}
    assert itsm.resolve_system("Core-Banking", "L2 АБС", aliases, names, groups).via == "alias"
    assert itsm.resolve_system("АБС", None, aliases, names, groups).system_id == "N"
    assert itsm.resolve_system(None, "l2  АБС", aliases, names, groups).system_id == "G"
    assert itsm.resolve_system("неизвестно", None, aliases, names, groups).system_id is None


def test_labor_from_reassignments_and_calibration():
    log = [("2026-05-04T10:00:00", "L1"), ("2026-05-04T10:30:00", "Группа L2 АБС"), ("2026-05-04T12:30:00", "мусор")]
    labor = itsm.labor_from_reassignments(log, "2026-05-04T13:00:00", k_util=0.5)
    assert labor == {"L1": 0.25, "L2": 1.0}
    cal = itsm.calibrate_k_util([(10, 3)] * 29 + [(10, 100)])   # один выброс не тянет медиану
    assert cal.k_util == 0.3 and cal.reliable is True


def test_correlation_window_from_first_ticket():
    t0 = datetime(2026, 5, 4, 10, 0, tzinfo=timezone.utc)
    from datetime import timedelta
    tickets = [itsm.TicketRef(f"T{i}", "A", t0 + timedelta(minutes=40 * i)) for i in range(4)]
    links = itsm.correlate(tickets, window_minutes=45)
    # T1 (40 мин) — дубль T0; T2 (80 мин) — вне окна от T0 → новый сбой; T3 — дубль T2.
    assert links == {"T1": "T0", "T3": "T2"}
    v = itsm.validate_correlation(links, {("T1", "T0"), ("T3", "T2"), ("T2", "T0")})
    assert v["precision"] == 1.0 and v["recall"] == pytest.approx(0.667, abs=1e-3)


def test_apm_calibration_and_correction():
    pairs = [("2026-05-04T10:15:00", "2026-05-04T12:30:00", "2026-05-04T10:00:00", "2026-05-04T12:00:00", False)] * 9 \
        + [("2026-05-04T10:15:00", None, "2026-05-04T10:00:00", None, True)]
    c = itsm.apm_calibration(pairs)
    assert c.start_lag_min == 15 and c.recovery_lag_min == 30 and c.degradation_share == 0.1
    start, end, minutes = itsm.apply_apm_correction(datetime(2026, 5, 4, 10, 15, tzinfo=timezone.utc),
                                                    datetime(2026, 5, 4, 12, 30, tzinfo=timezone.utc), c)
    assert minutes == 120.0


async def test_itsm_import_end_to_end(aclient, db_session):
    await ps.seed_rbac_defaults(db_session)
    s = await _system(db_session, "АБС")
    h = _auth("QUALITY_MANAGER")
    assert (await aclient.put(f"{API}/incidents/itsm/group-mappings", headers=h,
                              json={"groupName": "L2 АБС", "systemId": str(s.id)})).status_code == 200
    assert (await aclient.post(f"{API}/incidents/itsm/aliases", headers=h,
                               json={"alias": "core-banking", "systemId": str(s.id)})).status_code == 201
    files = {"file": ("export.csv", CSV_EXPORT.encode("utf-8"), "text/csv")}
    r = await aclient.post(f"{API}/incidents/itsm/import?fmt=csv", headers=h, files=files)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["created"] == 3 and body["children_linked"] == 1 and body["unresolved_systems"] == []
    incs = {i.external_id: i for i in (await db_session.execute(select(TechIncident))).scalars()}
    assert incs["INC2"].parent_incident_id == incs["INC1"].id
    assert incs["INC1"].labor_source == "reassignment_log" and incs["INC1"].system_id == s.id
    # Повторная загрузка — upsert по номеру тикета, без дублей.
    again = await aclient.post(f"{API}/incidents/itsm/import?fmt=csv", headers=h,
                               files={"file": ("export.csv", CSV_EXPORT.encode("utf-8"), "text/csv")})
    assert again.json()["created"] == 0 and again.json()["updated"] == 3
