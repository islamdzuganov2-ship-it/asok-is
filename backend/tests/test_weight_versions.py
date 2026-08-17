"""Тесты версионирования весов и пересчёта истории (ТЗ v19 УК-05/06, Р-3 «пересчитать всю
историю»). Фикстуры — как в test_assessment_correction.py (система + полный каталог метрик
+ период с заполненными значениями)."""
import uuid

from sqlalchemy import select

from app.modules.assessment.models import AssessmentPeriod, AssessmentValue
from app.modules.quality import QUALITY_PAIRS, FormulaType, MetricCatalog, calculate_metric, map_to_level
from app.modules.quality.models import WeightSetVersion
from app.modules.quality.weight_versions import (
    ensure_active_version,
    get_active_version,
    recompute_and_snapshot,
)
from app.modules.systems import CriticalityClass, System


async def _system(db, name="АБС Core", criticality=CriticalityClass.MISSION_CRITICAL) -> System:
    system = System(id=uuid.uuid4(), name=name, code=f"S-{uuid.uuid4().hex[:8]}", criticality_class=criticality)
    db.add(system)
    await db.flush()
    return system


async def _metrics(db) -> list[MetricCatalog]:
    rows = [
        MetricCatalog(characteristic=c, subcharacteristic=s, formula_type=FormulaType(f), is_active=True)
        for c, s, f in QUALITY_PAIRS
    ]
    db.add_all(rows)
    await db.flush()
    return rows


async def _period(db, system, metrics, quarter="Q2-2026", x=0.5) -> AssessmentPeriod:
    period = AssessmentPeriod(id=uuid.uuid4(), system_id=system.id, period=quarter, status="CALCULATED")
    db.add(period)
    await db.flush()
    for metric in metrics:
        formula = metric.formula_type.value
        b = 100
        a = round(b * x) if formula == "DIRECT" else round(b * (1 - x))
        real_x = calculate_metric(a, b, formula)
        db.add(AssessmentValue(
            id=uuid.uuid4(), period_id=period.id, metric_id=metric.id,
            val_a=a, val_b=b, calculated_x=real_x, quality_level=map_to_level(real_x),
            data_source="TEST",
        ))
    await db.flush()
    return period


async def test_ensure_active_version_creates_when_none_exists(db_session):
    """ТЗ v19 УК-04/05: веса теперь по профилю критичности — версия несёт все 3 профиля,
    31 строку (w) на каждый + 8 характеристик (u) на каждый, засеянные из одного файла заказчика."""
    assert await get_active_version(db_session) is None
    version = await ensure_active_version(db_session)
    assert version.is_active is True
    assert set(version.subchar_weights.keys()) == {"MISSION CRITICAL", "BUSINESS CRITICAL", "BUSINESS OPERATIONAL"}
    for profile_rows in version.subchar_weights.values():
        assert len(profile_rows) == 31
    for profile_chars in version.char_weights.values():
        assert len(profile_chars) == 8


async def test_ensure_active_version_replaces_legacy_flat_shape_without_crashing(db_session):
    """Регресс: строка, заведённая ДО УК-04/05 (subchar_weights — плоский список [[c,s,w],...],
    не {profile: [...]}), не должна валить ensure_active_version() AttributeError'ом на .items() —
    должна быть распознана как «другое содержимое» и переиздана в новой по-профильной форме."""
    legacy = WeightSetVersion(
        id=uuid.uuid4(), label="legacy-flat",
        subchar_weights=[["Функциональная пригодность", "Функциональная полнота", 5]],
        char_weights=None, criticality_weights={"MISSION CRITICAL": 3.0}, is_active=True,
    )
    db_session.add(legacy)
    await db_session.flush()

    version = await ensure_active_version(db_session)
    assert version.id != legacy.id
    assert version.is_active is True
    assert isinstance(version.subchar_weights, dict)

    legacy_reloaded = await db_session.get(WeightSetVersion, legacy.id)
    assert legacy_reloaded.is_active is False


async def test_ensure_active_version_is_idempotent(db_session):
    v1 = await ensure_active_version(db_session)
    v2 = await ensure_active_version(db_session)
    assert v1.id == v2.id  # содержимое не изменилось → новая строка не создаётся


async def test_recompute_dry_run_writes_nothing(db_session):
    system = await _system(db_session)
    metrics = await _metrics(db_session)
    await _period(db_session, system, metrics, x=0.7)

    report = await recompute_and_snapshot(db_session, apply=False)
    assert report.applied is False
    assert report.periods_scored == 1
    assert get_active_version  # no-op sanity: активной версии всё ещё нет
    assert await get_active_version(db_session) is None


async def test_recompute_apply_creates_snapshots_and_activates_version(db_session):
    system = await _system(db_session)
    metrics = await _metrics(db_session)
    await _period(db_session, system, metrics, x=0.7)

    report = await recompute_and_snapshot(db_session, apply=True)
    assert report.applied is True
    assert report.periods_scored == 1
    assert len(report.newly_scored) == 1
    assert report.newly_scored[0].previous_score is None
    assert report.newly_scored[0].new_score is not None

    active = await get_active_version(db_session)
    assert active is not None
    assert active.id == report.weight_version_id


async def test_recompute_reports_delta_when_data_changes(db_session):
    system = await _system(db_session)
    metrics = await _metrics(db_session)
    period = await _period(db_session, system, metrics, x=0.5)

    first = await recompute_and_snapshot(db_session, apply=True)
    assert first.newly_scored[0].new_score is not None
    first_score = first.newly_scored[0].new_score

    # Ухудшаем все значения периода — имитация «данные обновились между пересчётами».
    values = (await db_session.execute(
        select(AssessmentValue).where(AssessmentValue.period_id == period.id)
    )).scalars().all()
    for v in values:
        v.calculated_x = 0.1
    await db_session.flush()

    second = await recompute_and_snapshot(db_session, apply=True)
    assert second.unchanged_count == 0
    assert len(second.changed) == 1
    assert second.changed[0].previous_score == first_score
    assert second.changed[0].new_score < first_score
    assert second.changed[0].delta < 0


async def test_recompute_applies_weights_not_flat_average(db_session):
    """Регрессия к самому смыслу задачи: если веса не применяются, результат совпадает с
    плоским средним по количеству подхарактеристик. Здесь ровно половина подхар. (по счёту)
    на максимуме X=1, половина на минимуме X=0 — плоское среднее дало бы 50. Но подхар. с
    большим весом (>=4) выбраны на максимум, с меньшим — на минимум, поэтому взвешенный балл
    обязан быть заметно выше 50."""
    system = await _system(db_session)
    metrics = await _metrics(db_session)
    period = AssessmentPeriod(id=uuid.uuid4(), system_id=system.id, period="Q3-2026", status="CALCULATED")
    db_session.add(period)
    await db_session.flush()

    from app.modules.quality.weights import SUBCHAR_WEIGHTS
    for metric in metrics:
        w = SUBCHAR_WEIGHTS.get((metric.characteristic, metric.subcharacteristic), 0)
        want_high = w >= 4  # «тяжёлые» подхар. — на максимум, «лёгкие» — на минимум
        formula = metric.formula_type.value
        a, b = (100, 100) if (want_high == (formula == "DIRECT")) else (0, 100)
        real_x = calculate_metric(a, b, formula)
        db_session.add(AssessmentValue(
            id=uuid.uuid4(), period_id=period.id, metric_id=metric.id,
            val_a=a, val_b=b, calculated_x=real_x, quality_level=map_to_level(real_x),
            data_source="TEST",
        ))
    await db_session.flush()

    report = await recompute_and_snapshot(db_session, apply=True)
    score = report.newly_scored[0].new_score
    assert score > 55, f"взвешенный балл {score} не отличается от плоского среднего — веса не применяются"
