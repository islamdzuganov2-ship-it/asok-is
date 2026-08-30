"""Динамика портфельных величин (ТЗ v21, КП-12 — плитки CEO 5.1 и CTO «Что просело?»).

Слайд 11 обещает детектор аномалий (≥12 п.п.) на уровне портфеля; сегодня он есть только для
одной ИС («Динамика качества»). Проверяет реальный расчёт по score/availability и честную
пустоту там, где истории по периодам не существует (ale/closure — текущие значения, не ряд).
"""
from datetime import datetime, timedelta, timezone

from app.modules.assessment.models import AssessmentPeriod, AssessmentValue
from app.modules.econ.portfolio_trend_service import portfolio_trend
from app.modules.incidents.models import TechIncident
from app.modules.quality.models import FormulaType, MetricCatalog
from app.modules.systems.models import CriticalityClass, System


async def test_ale_and_closure_report_no_history(db_session):
    t = await portfolio_trend(db_session, metric="ale")
    assert t.points == []
    assert t.empty_reason

    t2 = await portfolio_trend(db_session, metric="closure")
    assert t2.points == []
    assert t2.empty_reason


async def test_score_trend_averages_across_systems_and_flags_anomaly(db_session):
    sys = System(name="ИС-Тренд", criticality_class=CriticalityClass.BUSINESS_CRITICAL)
    db_session.add(sys)
    metric = MetricCatalog(
        characteristic="Надёжность", subcharacteristic="Отказоустойчивость",
        formula_type=FormulaType.DIRECT,
    )
    db_session.add(metric)
    await db_session.commit()
    await db_session.refresh(sys)
    await db_session.refresh(metric)

    p1 = AssessmentPeriod(system_id=sys.id, period="2026-Q1", status="FINAL")
    p2 = AssessmentPeriod(system_id=sys.id, period="2026-Q2", status="FINAL")
    db_session.add_all([p1, p2])
    await db_session.commit()
    await db_session.refresh(p1)
    await db_session.refresh(p2)

    db_session.add_all([
        AssessmentValue(period_id=p1.id, metric_id=metric.id, calculated_x=80),
        AssessmentValue(period_id=p2.id, metric_id=metric.id, calculated_x=60),  # -20 п.п. → аномалия
    ])
    await db_session.commit()

    t = await portfolio_trend(db_session, metric="score")
    assert [p.period for p in t.points] == ["2026-Q1", "2026-Q2"]
    assert [p.value for p in t.points] == [80.0, 60.0]
    assert t.delta_absolute == -20.0
    assert t.anomaly is True


async def test_availability_trend_from_incidents_by_quarter(db_session):
    now = datetime.now(timezone.utc)
    # Один сбой давно (предыдущий квартал условно), один недавно — просто проверяем, что
    # ряд строится и не падает при наличии данных.
    db_session.add_all([
        TechIncident(system_name="ИС-Надёжность", category="INFRASTRUCTURE", title="Сбой 1",
                    occurred_at=now - timedelta(days=95), downtime_minutes=60),
        TechIncident(system_name="ИС-Надёжность", category="NETWORK", title="Сбой 2",
                    occurred_at=now - timedelta(days=5), downtime_minutes=30),
    ])
    await db_session.commit()

    t = await portfolio_trend(db_session, metric="availability")
    assert len(t.points) >= 1
    assert all(0 <= p.value <= 100 for p in t.points)


async def test_unknown_metric_reports_reason(db_session):
    t = await portfolio_trend(db_session, metric="bogus")
    assert t.points == []
    assert t.empty_reason
