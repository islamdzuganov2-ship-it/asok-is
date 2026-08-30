"""Агрегатор кокпита (ТЗ v21 §10.5, КП-41) — один запрос вместо пяти-шести.

Проверяет, что бандл собирает те же цифры, что и прямые эндпоинты (не пересчитывает, не
расходится), и что фильтр разреза (system_id/criticality/characteristic) доходит до каждого
вложенного вызова.
"""
from app.modules.econ.dashboard_service import cost_dashboard
from app.modules.reporting.cockpit_service import CockpitFilters, ceo_bundle, cto_bundle
from app.modules.risk.models import RiskEvent
from app.modules.systems.models import CriticalityClass, System


async def test_ceo_bundle_matches_direct_endpoint_calls(db_session):
    sys = System(name="ИС-Бандл", criticality_class=CriticalityClass.MISSION_CRITICAL)
    db_session.add(sys)
    await db_session.commit()
    await db_session.refresh(sys)
    db_session.add(RiskEvent(code="BUNDLE-1", title="Риск", ale_avg=500_000, system_id=sys.id))
    await db_session.commit()

    direct = await cost_dashboard(db_session)
    bundle = await ceo_bundle(db_session, CockpitFilters())

    assert bundle["costDashboard"].portfolio_ale == direct.portfolio_ale == 500_000.0
    assert "acceptanceQueue" in bundle
    assert "portfolioSummary" in bundle
    assert "effectCurve" in bundle
    assert "overdueSummary" in bundle


async def test_ceo_bundle_applies_system_filter_to_every_sub_call(db_session):
    sys_a = System(name="ИС-А-Бандл", criticality_class=CriticalityClass.MISSION_CRITICAL)
    sys_b = System(name="ИС-Б-Бандл", criticality_class=CriticalityClass.MISSION_CRITICAL)
    db_session.add_all([sys_a, sys_b])
    await db_session.commit()
    await db_session.refresh(sys_a)
    await db_session.refresh(sys_b)
    db_session.add_all([
        RiskEvent(code="BUNDLE-A", title="Риск А", ale_avg=300_000, system_id=sys_a.id),
        RiskEvent(code="BUNDLE-B", title="Риск Б", ale_avg=700_000, system_id=sys_b.id),
    ])
    await db_session.commit()

    bundle = await ceo_bundle(db_session, CockpitFilters(system_id=[sys_a.id]))
    assert bundle["costDashboard"].portfolio_ale == 300_000.0
    assert bundle["portfolioSummary"].total_at_risk == 300_000.0


async def test_cto_bundle_has_expected_keys(db_session):
    bundle = await cto_bundle(db_session, CockpitFilters())
    assert set(bundle.keys()) == {
        "portfolioTrendScore", "incidentAnalytics", "triggeredRisks", "managerMetrics",
    }
    assert bundle["incidentAnalytics"].total == 0  # честная пустота, не поднятое исключение


async def test_cto_bundle_resolves_single_system_id_to_name_for_incidents(db_session):
    """/incidents и /risks/triggered фильтруют по имени — бандл обязан резолвить id → имя,
    иначе фильтр системы молча не применяется (см. docstring cockpit_service.cto_bundle)."""
    from datetime import datetime, timezone
    from app.modules.incidents.models import TechIncident

    sys = System(name="ИС-Резолв", criticality_class=CriticalityClass.MISSION_CRITICAL)
    db_session.add(sys)
    await db_session.commit()
    await db_session.refresh(sys)
    now = datetime.now(timezone.utc)
    db_session.add(TechIncident(system_id=sys.id, system_name=sys.name, category="NETWORK",
                               title="Сбой", occurred_at=now))
    db_session.add(TechIncident(system_id=None, system_name="Другая ИС", category="NETWORK",
                               title="Сбой 2", occurred_at=now))
    await db_session.commit()

    scoped = await cto_bundle(db_session, CockpitFilters(system_id=[sys.id]))
    assert scoped["incidentAnalytics"].total == 1

    unscoped = await cto_bundle(db_session, CockpitFilters())
    assert unscoped["incidentAnalytics"].total == 2
