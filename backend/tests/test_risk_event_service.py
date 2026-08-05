"""Тесты рискового события (BL-007, RE-08/09) на сервисном слое.

Ключевой сценарий — сквозной пересчёт ALE: справочники econ (ставки, стоимость БП) + техсбой →
C_ТС движком → SLE/ARO → ALE. Плюс инварианты связей (дедуп, existence) и экспертный ARO.
"""
from datetime import datetime, timezone

import pytest

from app.modules.econ import service as econ
from app.modules.econ.schemas import BpCostIn, BusinessProcessCreate, SupportRateIn, SystemBpCreate
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
