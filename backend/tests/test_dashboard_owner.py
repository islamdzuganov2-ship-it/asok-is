"""ТЗ v19 п.5 (УК-05) — «разрез по руководителю»: у каждой проблемной ИС на дашборде должен
быть её СОБСТВЕННЫЙ ответственный (System.owner/owner_user_id), а не одна и та же заглушка на
все системы. Раньше фронт (ExecutiveDashboard.tsx buildExecFromLive) подставлял захардкоженное
имя для любой ИС — баг обнаружен на этой сессии при ревью покрытия карточек владельцем.

Фикстуры — как в test_weight_versions.py (система + метрика + период с заполненным значением),
но с двумя системами и РАЗНЫМИ owner, чтобы поймать регресс «одно и то же имя для всех».
"""
import uuid

from app.modules.assessment.models import AssessmentPeriod, AssessmentValue
from app.modules.assessment.router import get_dashboard
from app.modules.quality import FormulaType, MetricCatalog, calculate_metric, map_to_level
from app.modules.reporting.router import get_executive_dashboard
from app.modules.systems import CriticalityClass, System


async def _system(db, name, owner, criticality=CriticalityClass.MISSION_CRITICAL) -> System:
    system = System(id=uuid.uuid4(), name=name, code=f"S-{uuid.uuid4().hex[:8]}",
                    criticality_class=criticality, owner=owner)
    db.add(system)
    await db.flush()
    return system


async def _low_metric_period(db, system) -> None:
    """Один показатель ниже порога «проблемности» (0.41) — система попадает в problematicSystems."""
    metric = MetricCatalog(characteristic="Надёжность", subcharacteristic="Отказоустойчивость",
                           formula_type=FormulaType.DIRECT, is_active=True)
    db.add(metric)
    await db.flush()
    period = AssessmentPeriod(id=uuid.uuid4(), system_id=system.id, period="Q2-2026", status="CALCULATED")
    db.add(period)
    await db.flush()
    x = calculate_metric(30, 100, "DIRECT")  # 0.30 < 0.41 — проблемная
    db.add(AssessmentValue(
        id=uuid.uuid4(), period_id=period.id, metric_id=metric.id,
        val_a=30, val_b=100, calculated_x=x, quality_level=map_to_level(x), data_source="TEST",
    ))
    await db.flush()


async def test_executive_dashboard_carries_distinct_owner_per_system(db_session):
    s1 = await _system(db_session, "ИС-Один", "Иванов И.И.")
    s2 = await _system(db_session, "ИС-Два", "Петров П.П.")
    await _low_metric_period(db_session, s1)
    await _low_metric_period(db_session, s2)
    await db_session.commit()

    out = await get_executive_dashboard(db=db_session, _={})
    by_name = {row.name: row for row in out.problematicSystems}
    assert by_name["ИС-Один"].owner == "Иванов И.И."
    assert by_name["ИС-Два"].owner == "Петров П.П."
    assert by_name["ИС-Один"].owner != by_name["ИС-Два"].owner  # не общая заглушка


async def test_executive_dashboard_owner_absent_not_fabricated(db_session):
    s = await _system(db_session, "ИС-Без-Владельца", owner=None)
    await _low_metric_period(db_session, s)
    await db_session.commit()

    out = await get_executive_dashboard(db=db_session, _={})
    row = next(r for r in out.problematicSystems if r.name == "ИС-Без-Владельца")
    assert row.owner is None  # честное «нет данных», не выдуманное имя


async def test_assessment_dashboard_carries_distinct_owner_per_system(db_session):
    s1 = await _system(db_session, "ИС-Три", "Сидоров С.С.")
    s2 = await _system(db_session, "ИС-Четыре", "Козлова Е.В.")
    await _low_metric_period(db_session, s1)
    await _low_metric_period(db_session, s2)
    await db_session.commit()

    out = await get_dashboard(db=db_session, _={})
    by_name = {row["name"]: row for row in out["problematicSystems"]}
    assert by_name["ИС-Три"]["owner"] == "Сидоров С.С."
    assert by_name["ИС-Четыре"]["owner"] == "Козлова Е.В."
