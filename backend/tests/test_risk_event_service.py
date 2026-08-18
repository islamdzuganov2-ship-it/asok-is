"""Тесты рискового события (BL-007, RE-08/09) на сервисном слое.

Ключевой сценарий — сквозной пересчёт ALE: справочники econ (ставки, стоимость БП) + техсбой →
C_ТС движком → SLE/ARO → ALE. Плюс инварианты связей (дедуп, existence) и экспертный ARO.
"""
from datetime import datetime, timezone

import pytest

from app.modules.econ import service as econ
from app.modules.econ.schemas import BpCostIn, BusinessProcessCreate, SupportRateIn, SystemBpCreate
from app.modules.governance import Proposal
from app.modules.incidents.models import TechIncident
from app.modules.risk import event_service as service
from app.modules.risk.event_schemas import (
    IncidentLinkIn,
    MeasureLinkIn,
    RiskEventCreate,
    SubcharLinkIn,
)
from app.modules.systems.models import CriticalityClass, System
from app.shared.exceptions import ConflictError, NotFoundError
import uuid


async def _system(db, name="ИС-риск") -> System:
    s = System(name=name, criticality_class=CriticalityClass.MISSION_CRITICAL)
    db.add(s)
    await db.commit()
    await db.refresh(s)
    return s


async def _incident(db, system: System, **kw) -> TechIncident:
    base = dict(
        system_id=system.id, system_name=system.name, category="INFRASTRUCTURE", severity="high",
        title="Отказ узла", occurred_at=datetime(2026, 5, 4, 10, 0, tzinfo=timezone.utc),  # Пн, рабочее
        source="import",
    )
    base.update(kw)
    inc = TechIncident(**base)
    db.add(inc)
    await db.commit()
    await db.refresh(inc)
    return inc


async def _cost_env(db, system: System) -> None:
    """Справочники для C_ТС: стоимость минуты БП 1000 ₽ + связь ИС↔БП + ставка L2 2000 ₽/ч."""
    bp = await econ.create_business_process(db, BusinessProcessCreate(code="BP-RE", name="Расчёты", kind="FRONTAL"))
    await econ.upsert_bp_cost(db, bp.id, BpCostIn(method="RESOURCE", cost_per_min_base=1000))
    await econ.link_system_bp(db, system.id, SystemBpCreate(business_process_id=bp.id, share=1.0))
    await econ.create_rate(db, SupportRateIn(line="L2", rate_per_hour=2000))


# ── CRUD/связи ──

async def test_create_event_and_reject_duplicate_code(db_session):
    ev = await service.create_event(db_session, RiskEventCreate(code="RE-1", title="Отказ ЦОД"), "rm")
    assert ev.code == "RE-1" and ev.status == "active" and ev.created_by == "rm"
    with pytest.raises(ConflictError):
        await service.create_event(db_session, RiskEventCreate(code="RE-1", title="Дубль"), "rm")


async def test_link_subchar_dedup(db_session):
    ev = await service.create_event(db_session, RiskEventCreate(code="RE-2", title="Риск"), "rm")
    await service.link_subchar(db_session, ev.id, SubcharLinkIn(characteristic="Надёжность", subcharacteristic="Отказоустойчивость"))
    with pytest.raises(ConflictError):
        await service.link_subchar(db_session, ev.id, SubcharLinkIn(characteristic="Надёжность", subcharacteristic="Отказоустойчивость"))


async def test_link_incident_requires_existing(db_session):
    ev = await service.create_event(db_session, RiskEventCreate(code="RE-3", title="Риск"), "rm")
    with pytest.raises(NotFoundError):
        await service.link_incident(db_session, ev.id, uuid.uuid4())
    sys = await _system(db_session)
    inc = await _incident(db_session, sys)
    link = await service.link_incident(db_session, ev.id, inc.id)
    assert link.incident_id == inc.id
    with pytest.raises(ConflictError):
        await service.link_incident(db_session, ev.id, inc.id)


async def test_link_measure_requires_existing_proposal(db_session):
    ev = await service.create_event(db_session, RiskEventCreate(code="RE-4", title="Риск"), "rm")
    with pytest.raises(NotFoundError):
        await service.link_measure(db_session, ev.id, MeasureLinkIn(proposal_id=uuid.uuid4()))


# ── Сквозной пересчёт ALE (RE-09) ──

async def test_recompute_ale_from_incident_cost(db_session):
    sys = await _system(db_session)
    await _cost_env(db_session, sys)
    # C_ТС ожидаемо: восстановление 2ч×2000×1.0=4000 + простой 60мин×1000×1.0×1.0=60000 = 64000.
    inc = await _incident(db_session, sys, downtime_minutes=60, k_impact=1.0, labor_l2_hours=2)
    ev = await service.create_event(db_session, RiskEventCreate(code="RE-5", title="Отказ"), "rm")
    await service.link_incident(db_session, ev.id, inc.id)

    res = await service.recompute_ale(db_session, ev)
    assert res.incidents_counted == 1 and res.incidents_costed == 1
    assert res.aro == 1.0                      # 1 ТС / окно 12 мес
    assert res.ale_avg == 64000.0              # ARO×SLE
    assert res.max_sle == 64000.0
    assert float(inc.cost_total) == 64000.0    # C_ТС закэширован в техсбое


async def test_recompute_ale_expert_aro_overrides_frequency(db_session):
    sys = await _system(db_session, name="ИС-эксперт")
    await _cost_env(db_session, sys)
    inc = await _incident(db_session, sys, downtime_minutes=60, k_impact=1.0, labor_l2_hours=2)
    ev = await service.create_event(
        db_session, RiskEventCreate(code="RE-6", title="Редкий катастрофический", aro=3, aro_is_expert=True), "rm",
    )
    await service.link_incident(db_session, ev.id, inc.id)

    res = await service.recompute_ale(db_session, ev)
    assert res.aro == 3.0                       # экспертный ARO не перетирается частотой
    assert res.ale_avg == 192000.0             # 3 × 64000
    assert ev.aro is not None and float(ev.aro) == 3.0


# ── ТЗ v19 п.4: ячейка теплокарты (ИС × характеристика) → риски + меры + деньги ──

async def test_cell_detail_aggregates_risks_and_money(db_session):
    sys = await _system(db_session, name="ИС-теплокарта")
    ev1 = await service.create_event(db_session, RiskEventCreate(code="RE-CELL-1", title="Риск A", system_id=sys.id), "rm")
    ev1.ale_avg = 100000
    ev2 = await service.create_event(db_session, RiskEventCreate(code="RE-CELL-2", title="Риск B", system_id=sys.id), "rm")
    ev2.ale_avg = 50000
    await db_session.commit()
    await service.link_subchar(db_session, ev1.id, SubcharLinkIn(characteristic="Надёжность", subcharacteristic="Отказоустойчивость"))
    await service.link_subchar(db_session, ev2.id, SubcharLinkIn(characteristic="Надёжность", subcharacteristic="Восстанавливаемость (MTTR)"))
    # Риск другой характеристики не должен попасть в выдачу.
    await service.link_subchar(db_session, ev1.id, SubcharLinkIn(characteristic="Защищённость", subcharacteristic="Целостность"))

    result = await service.cell_detail(db_session, "ИС-теплокарта", "Надёжность")
    assert result.system_name == "ИС-теплокарта"
    assert result.total_ale == 150000.0
    assert len(result.risks) == 2
    # Отсортировано по ALE по убыванию — риск A (100000) первый.
    assert result.risks[0].code == "RE-CELL-1"
    assert result.risks[0].subcharacteristics == ["Отказоустойчивость"]
    assert result.risks[1].code == "RE-CELL-2"


async def test_cell_detail_includes_linked_measures_with_money(db_session):
    sys = await _system(db_session, name="ИС-меры")
    ev = await service.create_event(db_session, RiskEventCreate(code="RE-CELL-3", title="Риск с мерой", system_id=sys.id), "rm")
    ev.ale_avg = 80000
    await db_session.commit()
    await service.link_subchar(db_session, ev.id, SubcharLinkIn(characteristic="Надёжность", subcharacteristic="Отказоустойчивость"))

    from app.modules.governance import Proposal
    proposal = Proposal(system_name="ИС-меры", characteristic="Надёжность", risk_title="Резервирование узла",
                        status="APPROVED", rosi=1.8, verdict="ELIMINATE")
    db_session.add(proposal)
    await db_session.flush()
    await service.link_measure(db_session, ev.id, MeasureLinkIn(proposal_id=proposal.id, ale_reduction_share=0.7))

    result = await service.cell_detail(db_session, "ИС-меры", "Надёжность")
    assert len(result.risks) == 1
    measures = result.risks[0].measures
    assert len(measures) == 1
    assert measures[0].title == "Резервирование узла"
    assert measures[0].ale_reduction_share == 0.7
    assert measures[0].rosi == 1.8
    assert measures[0].verdict == "ELIMINATE"


async def test_cell_detail_unknown_system_returns_empty_not_error(db_session):
    result = await service.cell_detail(db_session, "Несуществующая ИС", "Надёжность")
    assert result.risks == []
    assert result.total_ale == 0.0


async def test_cell_detail_ignores_archived_risks(db_session):
    sys = await _system(db_session, name="ИС-архив")
    ev = await service.create_event(db_session, RiskEventCreate(code="RE-CELL-4", title="Архивный риск", system_id=sys.id), "rm")
    ev.ale_avg = 999999
    await db_session.commit()
    await service.link_subchar(db_session, ev.id, SubcharLinkIn(characteristic="Надёжность", subcharacteristic="Отказоустойчивость"))
    await service.archive_event(db_session, ev)

    result = await service.cell_detail(db_session, "ИС-архив", "Надёжность")
    assert result.risks == []


# ── УК-11: денежный слой всей теплокарты (грид, не одна ячейка) ──

async def test_heatmap_money_layer_aggregates_per_system_and_characteristic(db_session):
    sys = await _system(db_session, name="ИС-грид")
    ev1 = await service.create_event(db_session, RiskEventCreate(code="RE-GRID-1", title="Риск A", system_id=sys.id), "rm")
    ev1.ale_avg = 100000
    ev2 = await service.create_event(db_session, RiskEventCreate(code="RE-GRID-2", title="Риск B", system_id=sys.id), "rm")
    ev2.ale_avg = 40000
    await db_session.commit()
    await service.link_subchar(db_session, ev1.id, SubcharLinkIn(characteristic="Надёжность", subcharacteristic="Отказоустойчивость"))
    await service.link_subchar(db_session, ev2.id, SubcharLinkIn(characteristic="Защищённость", subcharacteristic="Целостность"))

    cells = {(c.system_name, c.characteristic): c for c in await service.heatmap_money_layer(db_session)}
    assert cells[("ИС-грид", "Надёжность")].total_ale == 100000.0
    assert cells[("ИС-грид", "Защищённость")].total_ale == 40000.0


async def test_heatmap_money_layer_dedups_risk_across_two_subchars_of_same_characteristic(db_session):
    sys = await _system(db_session, name="ИС-дедуп")
    ev = await service.create_event(db_session, RiskEventCreate(code="RE-GRID-3", title="Риск", system_id=sys.id), "rm")
    ev.ale_avg = 70000
    await db_session.commit()
    await service.link_subchar(db_session, ev.id, SubcharLinkIn(characteristic="Надёжность", subcharacteristic="Отказоустойчивость"))
    await service.link_subchar(db_session, ev.id, SubcharLinkIn(characteristic="Надёжность", subcharacteristic="Восстанавливаемость (MTTR)"))

    cells = {(c.system_name, c.characteristic): c for c in await service.heatmap_money_layer(db_session)}
    # Один и тот же риск под двумя подхарактеристиками ОДНОЙ характеристики — ALE не удвоен.
    assert cells[("ИС-дедуп", "Надёжность")].total_ale == 70000.0


async def test_heatmap_money_layer_computes_delta_ale_and_coverage_from_measures(db_session):
    sys = await _system(db_session, name="ИС-покрытие")
    ev1 = await service.create_event(db_session, RiskEventCreate(code="RE-GRID-4", title="Риск с мерой", system_id=sys.id), "rm")
    ev1.ale_avg = 100000
    ev2 = await service.create_event(db_session, RiskEventCreate(code="RE-GRID-5", title="Риск без меры", system_id=sys.id), "rm")
    ev2.ale_avg = 50000
    await db_session.commit()
    await service.link_subchar(db_session, ev1.id, SubcharLinkIn(characteristic="Надёжность", subcharacteristic="Отказоустойчивость"))
    await service.link_subchar(db_session, ev2.id, SubcharLinkIn(characteristic="Надёжность", subcharacteristic="Отказоустойчивость"))

    from app.modules.governance import Proposal
    proposal = Proposal(system_name="ИС-покрытие", characteristic="Надёжность", risk_title="Мера",
                         status="APPROVED", rosi=1.5, verdict="ELIMINATE")
    db_session.add(proposal)
    await db_session.flush()
    await service.link_measure(db_session, ev1.id, MeasureLinkIn(proposal_id=proposal.id, ale_reduction_share=0.6))

    cells = {(c.system_name, c.characteristic): c for c in await service.heatmap_money_layer(db_session)}
    cell = cells[("ИС-покрытие", "Надёжность")]
    assert cell.total_ale == 150000.0
    assert cell.total_delta_ale == 60000.0          # 100000 × 0.6
    assert cell.coverage_pct == round(100000 / 150000 * 100, 1)   # только риск с мерой покрыт


async def test_heatmap_money_layer_empty_when_no_risks(db_session):
    assert await service.heatmap_money_layer(db_session) == []


# ── ТЗ v19 п.7 (УК-19/20): риск → мера → эффект + портфельный итог ──

async def test_risk_measure_chain_groups_measures_under_their_risk(db_session):
    sys = await _system(db_session, name="ИС-цепочка")
    ev = await service.create_event(db_session, RiskEventCreate(code="RE-CHAIN-1", title="Риск с двумя мерами", system_id=sys.id), "rm")
    ev.ale_avg = 200000
    await db_session.commit()

    p1 = Proposal(system_name="ИС-цепочка", characteristic="Надёжность", risk_title="Мера A",
                  status="APPROVED", execution="DONE", capex=100000, opex_per_year=10000,
                  delta_ale_cash=150000, rosi=1.2, verdict="ELIMINATE")
    p2 = Proposal(system_name="ИС-цепочка", characteristic="Надёжность", risk_title="Мера B",
                  status="PENDING_APPROVAL")
    db_session.add_all([p1, p2])
    await db_session.flush()
    await service.link_measure(db_session, ev.id, MeasureLinkIn(proposal_id=p1.id, ale_reduction_share=0.5))
    await service.link_measure(db_session, ev.id, MeasureLinkIn(proposal_id=p2.id, ale_reduction_share=0.2))

    rows = await service.risk_measure_chain(db_session)
    row = next(r for r in rows if r.risk_code == "RE-CHAIN-1")
    assert row.ale_avg == 200000.0
    assert row.system_name == "ИС-цепочка"
    assert {m.title for m in row.measures} == {"Мера A", "Мера B"}
    measure_a = next(m for m in row.measures if m.title == "Мера A")
    assert measure_a.execution == "DONE"
    assert measure_a.capex == 100000.0
    assert measure_a.ale_reduction_share == 0.5
    # payback: 100000 / (150000/12 - 10000/12) = 100000 / 11666.67 ≈ 8.6 мес
    assert measure_a.payback_months == round(100000 / (150000 / 12 - 10000 / 12), 1)


async def test_risk_measure_chain_ignores_archived_risks(db_session):
    sys = await _system(db_session, name="ИС-цепочка-архив")
    ev = await service.create_event(db_session, RiskEventCreate(code="RE-CHAIN-2", title="Архивный", system_id=sys.id), "rm")
    await service.archive_event(db_session, ev)
    rows = await service.risk_measure_chain(db_session)
    assert not any(r.risk_code == "RE-CHAIN-2" for r in rows)


async def test_risk_measure_chain_empty_when_no_risks(db_session):
    assert await service.risk_measure_chain(db_session) == []


async def test_portfolio_summary_splits_covered_vs_expected_by_execution(db_session):
    sys = await _system(db_session, name="ИС-портфель")
    ev1 = await service.create_event(db_session, RiskEventCreate(code="RE-PORT-1", title="Риск A", system_id=sys.id), "rm")
    ev1.ale_avg = 100000
    ev2 = await service.create_event(db_session, RiskEventCreate(code="RE-PORT-2", title="Риск B", system_id=sys.id), "rm")
    ev2.ale_avg = 50000
    await db_session.commit()

    done_measure = Proposal(system_name="ИС-портфель", characteristic="Надёжность", risk_title="Выполненная мера",
                            status="APPROVED", execution="DONE", capex=20000, opex_per_year=0)
    pending_measure = Proposal(system_name="ИС-портфель", characteristic="Надёжность", risk_title="Одобренная, не выполнена",
                               status="APPROVED", execution=None, capex=5000, opex_per_year=0)
    rejected_measure = Proposal(system_name="ИС-портфель", characteristic="Надёжность", risk_title="Отклонена",
                                status="REJECTED", capex=99999, opex_per_year=0)
    db_session.add_all([done_measure, pending_measure, rejected_measure])
    await db_session.flush()
    await service.link_measure(db_session, ev1.id, MeasureLinkIn(proposal_id=done_measure.id, ale_reduction_share=0.5))
    await service.link_measure(db_session, ev2.id, MeasureLinkIn(proposal_id=pending_measure.id, ale_reduction_share=0.4))
    await service.link_measure(db_session, ev1.id, MeasureLinkIn(proposal_id=rejected_measure.id, ale_reduction_share=1.0))

    summary = await service.portfolio_risk_summary(db_session)
    assert summary.total_at_risk == 150000.0
    assert summary.covered_by_done_measures == 50000.0     # 100000 × 0.5, только выполненная
    assert summary.residual_risk == 100000.0                # 150000 − 50000
    assert summary.expected_effect == 20000.0               # 50000 × 0.4, одобрена но не выполнена
    assert summary.required_investment == 25000.0           # 20000 + 5000 — отклонённая НЕ считается
    assert summary.risks_count == 2
    assert summary.measures_count == 2                      # rejected не входит


async def test_portfolio_summary_counts_investment_once_per_measure_across_risks(db_session):
    """Одна мера, закрывающая два риска — CAPEX/OPEX не задвоены (принадлежат мере, не связи)."""
    sys = await _system(db_session, name="ИС-задвоение")
    ev1 = await service.create_event(db_session, RiskEventCreate(code="RE-PORT-3", title="Риск A", system_id=sys.id), "rm")
    ev1.ale_avg = 100000
    ev2 = await service.create_event(db_session, RiskEventCreate(code="RE-PORT-4", title="Риск B", system_id=sys.id), "rm")
    ev2.ale_avg = 100000
    await db_session.commit()

    shared_measure = Proposal(system_name="ИС-задвоение", characteristic="Надёжность", risk_title="Общая мера",
                              status="APPROVED", execution="DONE", capex=30000, opex_per_year=0)
    db_session.add(shared_measure)
    await db_session.flush()
    await service.link_measure(db_session, ev1.id, MeasureLinkIn(proposal_id=shared_measure.id, ale_reduction_share=0.5))
    await service.link_measure(db_session, ev2.id, MeasureLinkIn(proposal_id=shared_measure.id, ale_reduction_share=0.5))

    summary = await service.portfolio_risk_summary(db_session)
    assert summary.required_investment == 30000.0   # не 60000
    assert summary.measures_count == 1
    assert summary.covered_by_done_measures == 100000.0   # 100000×0.5 + 100000×0.5


async def test_portfolio_summary_empty_when_no_risks(db_session):
    summary = await service.portfolio_risk_summary(db_session)
    assert summary.total_at_risk == 0.0
    assert summary.risks_count == 0
    assert summary.measures_count == 0
