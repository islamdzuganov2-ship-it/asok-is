"""Тест агрегации дашборда стоимости (BL-007, §5, RE-16).

Собирает срез из рисковых событий (ALE), несоответствий (воронка/вердикты/блокирующие) и
техсбоев (накопленная деградация) и проверяет свод для CTO/CEO.
"""
from datetime import datetime, timezone

from app.modules.econ.dashboard_service import cost_dashboard
from app.modules.incidents.models import TechIncident
from app.modules.nonconformity.models import (
    LEVEL_CRITICAL,
    STATUS_DECIDED,
    STATUS_IDENTIFIED,
    STATUS_VERIFIED,
    Nonconformity,
)
from app.modules.risk.models import RiskEvent, RiskEventSubchar
from app.modules.systems.models import CriticalityClass, System


async def test_cost_dashboard_aggregates_portfolio(db_session):
    sys = System(name="ИС-Дашборд", criticality_class=CriticalityClass.MISSION_CRITICAL)
    db_session.add(sys)
    await db_session.commit()
    await db_session.refresh(sys)

    re1 = RiskEvent(code="DASH-1", title="Отказ узла", ale_avg=1_000_000, owner="Орлов",
                    system_id=sys.id)
    re2 = RiskEvent(code="DASH-2", title="Компрометация", ale_avg=3_000_000, owner="Смирнов",
                    system_id=sys.id, regulatory=True)
    db_session.add_all([re1, re2])
    await db_session.commit()
    db_session.add_all([
        RiskEventSubchar(risk_event_id=re1.id, characteristic="Надёжность", subcharacteristic="Отказоустойчивость"),
        RiskEventSubchar(risk_event_id=re2.id, characteristic="Защищённость", subcharacteristic="Целостность"),
    ])

    # Несоответствия: 1 верифицировано, 1 принято (вердикт ACCEPT), 1 критическое-блокирующее.
    db_session.add_all([
        Nonconformity(system_name=sys.name, characteristic="Надёжность", subcharacteristic="Отказоустойчивость",
                      owner="Сидоров", status=STATUS_VERIFIED, level="MAJOR"),
        Nonconformity(system_name=sys.name, characteristic="Производительность", subcharacteristic="Отклик",
                      owner="Николаев", status=STATUS_DECIDED, decision_verdict="ACCEPT", level="MINOR"),
        Nonconformity(system_name=sys.name, characteristic="Надёжность", subcharacteristic="Восстанавливаемость",
                      owner="Сидоров", status=STATUS_IDENTIFIED, level=LEVEL_CRITICAL, is_blocking=True),
    ])

    # Техсбой-деградация с посчитанной стоимостью → накопленная деградация.
    db_session.add(TechIncident(
        system_id=sys.id, system_name=sys.name, category="PERFORMANCE", title="Деградация отклика",
        occurred_at=datetime(2026, 5, 4, 11, 0, tzinfo=timezone.utc),
        incident_type="DEGRADATION", cost_total=200_000,
    ))
    await db_session.commit()

    dash = await cost_dashboard(db_session)

    assert dash.portfolio_ale == 4_000_000.0
    assert dash.risks_count == 2
    assert dash.top_risks[0].code == "DASH-2"          # крупнейший ALE первым
    assert dash.top_risks[0].regulatory is True
    assert len(dash.heatmap) == 2                       # две пары ИС×подхарактеристика
    assert dash.degradation_total == 200_000.0
    assert dash.nonconformities_total == 3
    assert dash.verified == 1
    assert dash.closure_rate == 33.3
    assert dash.verdict.accept == 1
    assert dash.blocking_count == 1
    # ALE по ИС — вся сумма на одной системе.
    assert dash.by_system[0].system == "ИС-Дашборд" and dash.by_system[0].ale == 4_000_000.0


async def test_cost_dashboard_filters_by_criticality_and_characteristic(db_session):
    """ТЗ v21 §10.4: criticality/characteristic — сквозной разрез, не только system_id."""
    mc = System(name="ИС-Крит", criticality_class=CriticalityClass.MISSION_CRITICAL)
    bo = System(name="ИС-Обычная", criticality_class=CriticalityClass.BUSINESS_OPERATIONAL)
    db_session.add_all([mc, bo])
    await db_session.commit()
    await db_session.refresh(mc)
    await db_session.refresh(bo)

    re_mc = RiskEvent(code="CRIT-1", title="Риск MC", ale_avg=1_000_000, system_id=mc.id)
    re_bo = RiskEvent(code="CRIT-2", title="Риск BO", ale_avg=500_000, system_id=bo.id)
    db_session.add_all([re_mc, re_bo])
    await db_session.commit()
    db_session.add(RiskEventSubchar(risk_event_id=re_mc.id, characteristic="Надёжность",
                                    subcharacteristic="Отказоустойчивость"))
    db_session.add(RiskEventSubchar(risk_event_id=re_bo.id, characteristic="Переносимость",
                                    subcharacteristic="Адаптируемость"))
    await db_session.commit()

    only_mc = await cost_dashboard(db_session, criticality=["MISSION CRITICAL"])
    assert only_mc.portfolio_ale == 1_000_000.0 and only_mc.risks_count == 1

    only_reliability = await cost_dashboard(db_session, characteristic="Надёжность")
    assert only_reliability.portfolio_ale == 1_000_000.0 and only_reliability.risks_count == 1

    both = await cost_dashboard(db_session, criticality=["BUSINESS OPERATIONAL"], characteristic="Надёжность")
    assert both.risks_count == 0  # BO-система не имеет риска по «Надёжности»

    everything = await cost_dashboard(db_session)
    assert everything.portfolio_ale == 1_500_000.0 and everything.risks_count == 2
