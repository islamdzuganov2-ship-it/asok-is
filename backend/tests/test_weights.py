"""Тесты гибридных весов подхарактеристик (BL-007, RE-15, §4.3).

Чистые функции (α, гибрид, профиль) — без БД. Агрегация — на db_session: без данных доминирует
нормативный профиль (α=1), с фактикой ALE и ТС растёт риск-ориентированный вклад, а N снижает α.
"""
from datetime import datetime, timezone

import pytest

from app.modules.econ.weights_service import (
    BUSINESS_CRITICAL,
    MISSION_CRITICAL,
    SUPPORT,
    alpha_for,
    compute_subchar_weights,
    hybrid_weight,
    profile_by_subchar,
)
from app.modules.incidents.models import TechIncident
from app.modules.risk.models import RiskEvent, RiskEventIncident, RiskEventSubchar


# ── Чистые функции ──

def test_alpha_transition_by_data_sufficiency():
    assert alpha_for(0) == 1.0                 # данных нет → только профиль
    assert alpha_for(6) == round(12 / 18, 4)   # 0.6667 — профиль доминирует
    assert alpha_for(12) == 0.5                 # паритет
    assert alpha_for(36) == 0.3                 # 12/48=0.25 < α_min → упор в α_min (защита §4.3)


def test_hybrid_weight_blends_profile_and_factual():
    assert hybrid_weight(0.5, 0.1, 0.2) == pytest.approx(0.15)
    assert hybrid_weight(1.0, 0.1, 0.9) == pytest.approx(0.1)   # α=1 → только профиль
    assert hybrid_weight(0.0, 0.1, 0.9) == pytest.approx(0.9)   # α=0 → только фактика


def test_profiles_sum_to_one_per_class():
    for crit in (MISSION_CRITICAL, BUSINESS_CRITICAL, SUPPORT):
        total = sum(profile_by_subchar(crit).values())
        assert total == pytest.approx(1.0, abs=1e-9)


def test_profile_splits_characteristic_equally():
    p = profile_by_subchar(MISSION_CRITICAL)
    # Надёжность у Mission = 0.22 на 4 подхарактеристики → 0.055 каждой.
    rel = [v for (c, _s), v in p.items() if c == "Надёжность"]
    assert len(rel) == 4 and all(v == pytest.approx(0.055) for v in rel)


# ── Агрегация без данных: чистый профиль ──

async def test_weights_without_data_equal_normalized_profile(db_session):
    res = await compute_subchar_weights(db_session, criticality=BUSINESS_CRITICAL)
    assert res.total_ale == 0.0
    assert len(res.weights) == 31                         # все подхарактеристики ГОСТ 25010
    assert sum(w.final_weight for w in res.weights) == pytest.approx(1.0, abs=1e-3)
    assert all(w.alpha == 1.0 for w in res.weights)       # N=0 везде → профиль
    assert res.dominant_source == "profile"
    # Без фактики итог = профиль: топ — подхарактеристика самой весомой характеристики.
    assert res.weights[0].final_weight == pytest.approx(res.weights[0].profile_weight, abs=1e-3)


async def test_mission_profile_tops_reliability_without_data(db_session):
    res = await compute_subchar_weights(db_session, criticality=MISSION_CRITICAL)
    assert res.weights[0].characteristic == "Надёжность"  # Mission → надёжность весит больше всех


# ── Агрегация с данными: фактика двигает вес, N снижает α ──

async def test_factual_ale_raises_subchar_weight_and_incident_lowers_alpha(db_session):
    inc = TechIncident(system_name="АБС Core", category="INFRASTRUCTURE", title="Инцидент ИБ",
                       occurred_at=datetime(2026, 5, 4, 11, 0, tzinfo=timezone.utc), source="import")
    db_session.add(inc)
    await db_session.flush()
    ev = RiskEvent(code="RE-W-1", title="Компрометация целостности", ale_avg=10_000_000, status="active")
    db_session.add(ev)
    await db_session.flush()
    db_session.add_all([
        RiskEventSubchar(risk_event_id=ev.id, characteristic="Защищённость", subcharacteristic="Целостность"),
        RiskEventIncident(risk_event_id=ev.id, incident_id=inc.id),
    ])
    await db_session.commit()

    res = await compute_subchar_weights(db_session, criticality=MISSION_CRITICAL)
    assert res.total_ale == 10_000_000.0
    integ = next(w for w in res.weights if w.subcharacteristic == "Целостность")
    assert integ.n_incidents == 1
    assert integ.alpha == alpha_for(1)                    # 12/13 ≈ 0.9231
    assert integ.factual_weight == pytest.approx(1.0)     # единственный ALE в портфеле
    assert integ.final_weight > integ.profile_weight      # фактика подняла вес выше нормативного
    assert res.weights[0].subcharacteristic == "Целостность"  # стала самой весомой
    assert sum(w.final_weight for w in res.weights) == pytest.approx(1.0, abs=1e-3)
