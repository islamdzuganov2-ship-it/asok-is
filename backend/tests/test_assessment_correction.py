"""Тесты вкладок «Внесение данных» (ТЗ v16): корректировка оценки (T-47) и
внесение профессионального суждения (T-48).

Проверяется бизнес-логика роутера assessment (сервисного слоя у домена нет — эндпоинты
вызываются напрямую с тестовой сессией; ролевые Depends в этом слое не участвуют):
  • завершённая оценка закрыта на правку, разблокировка возвращает её в CALCULATED (T-47);
  • judgments-pending отдаёт ТОЛЬКО пары без профессионального суждения и после его
    внесения строка уходит из выдачи; архивные периоды — по флагу all_periods (T-48).
"""
import uuid

import pytest
from fastapi import HTTPException

from app.modules.assessment.models import AssessmentPeriod, AssessmentValue, ProfessionalJudgment
from app.modules.assessment.router import (
    add_assessment_value,
    finalize_assessment,
    judgments_pending,
    reopen_assessment,
    save_assessment_metrics,
    save_judgments,
)
from app.modules.assessment.schemas import EditableMetricIn, JudgmentIn, ValueAddIn
from app.modules.quality import QUALITY_PAIRS, FormulaType, MetricCatalog, calculate_metric, map_to_level
from app.modules.systems import CriticalityClass, System
from app.shared.periods import (
    PERIOD_LOCKED_MESSAGE,
    STATUS_CALCULATED,
    STATUS_COMPLETE,
    is_period_locked,
)

USER = {"username": "qm"}


async def _system(db, name="АБС Core", code=None) -> System:
    system = System(
        id=uuid.uuid4(), name=name, code=code or f"S-{uuid.uuid4().hex[:8]}",
        criticality_class=CriticalityClass.BUSINESS_CRITICAL,
    )
    db.add(system)
    await db.flush()
    return system


async def _metrics(db) -> list[MetricCatalog]:
    """Каталог метрик = все 31 пара эталонной модели (в полноту идут только они)."""
    rows = [
        MetricCatalog(
            characteristic=characteristic, subcharacteristic=sub,
            formula_type=FormulaType(formula), is_active=True,
        )
        for characteristic, sub, formula in QUALITY_PAIRS
    ]
    db.add_all(rows)
    await db.flush()
    return rows


async def _period(db, system, metrics, quarter="Q2-2026", status=STATUS_CALCULATED,
                  x=0.5, filled=None) -> AssessmentPeriod:
    """Период с заполненными значениями (filled=None → все пары модели)."""
    period = AssessmentPeriod(id=uuid.uuid4(), system_id=system.id, period=quarter, status=status)
    db.add(period)
    await db.flush()
    for metric in metrics[: filled if filled is not None else len(metrics)]:
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


# ─── T-47: корректировка завершённой оценки ───

async def test_finalized_assessment_is_locked_for_edit(db_session):
    system = await _system(db_session)
    metrics = await _metrics(db_session)
    period = await _period(db_session, system, metrics)

    summary = await finalize_assessment(period.id, db_session, USER)
    assert summary.status == STATUS_COMPLETE and summary.complete

    # Правка завершённой оценки запрещена — 409 с подсказкой про разблокировку.
    payload = [EditableMetricIn(id=str(uuid.uuid4()), val_a=1, val_b=2)]
    with pytest.raises(HTTPException) as err:
        await save_assessment_metrics(period.id, payload, db_session)
    assert err.value.status_code == 409
    assert "корректировк" in err.value.detail.lower()


async def test_reopen_unlocks_and_edit_persists(db_session):
    system = await _system(db_session)
    metrics = await _metrics(db_session)
    period = await _period(db_session, system, metrics, x=0.5)
    await finalize_assessment(period.id, db_session, USER)

    summary = await reopen_assessment(period.id, db_session, USER)
    assert summary.status == STATUS_CALCULATED
    assert summary.filled == summary.total and summary.complete  # значения не потеряны

    # После разблокировки значение правится обычным сохранением и X пересчитывается.
    value = (await db_session.execute(
        AssessmentValue.__table__.select().where(AssessmentValue.period_id == period.id).limit(1)
    )).first()
    result = await save_assessment_metrics(
        period.id,
        [EditableMetricIn(id=str(value.id), val_a=90, val_b=100, expert_comment="исправлено")],
        db_session,
    )
    assert result["updated"] == 1 and not result["errors"]
    fresh = await db_session.get(AssessmentValue, value.id)
    assert float(fresh.calculated_x) in (0.9, 0.1)  # DIRECT → 0.9, INVERSE → 1 − 0.9
    assert fresh.expert_comment == "исправлено"

    # Оценку завершают заново — она снова заблокирована.
    again = await finalize_assessment(period.id, db_session, USER)
    assert again.status == STATUS_COMPLETE


async def test_lock_is_shared_across_write_paths(db_session):
    # Правило блокировки живёт в app.shared.periods и применяется всеми путями записи:
    # табличный ввод (PUT /metrics), API значений (POST /values) и импорт Excel (dataio,
    # проверяется тем же is_period_locked/PERIOD_LOCKED_MESSAGE перед разбором файла).
    system = await _system(db_session)
    metrics = await _metrics(db_session)
    period = await _period(db_session, system, metrics)
    await finalize_assessment(period.id, db_session, USER)

    assert is_period_locked(period.status)
    with pytest.raises(HTTPException) as err:
        await add_assessment_value(
            period.id,
            ValueAddIn(characteristic=metrics[0].characteristic,
                       subcharacteristic=metrics[0].subcharacteristic, val_a=1, val_b=2),
            db_session, USER,
        )
    assert err.value.status_code == 409 and err.value.detail == PERIOD_LOCKED_MESSAGE

    await reopen_assessment(period.id, db_session, USER)
    assert not is_period_locked(period.status)


async def test_reopen_rejects_not_finalized(db_session):
    system = await _system(db_session)
    metrics = await _metrics(db_session)
    period = await _period(db_session, system, metrics)
    with pytest.raises(HTTPException) as err:
        await reopen_assessment(period.id, db_session, USER)
    assert err.value.status_code == 409


# ─── T-48: метрики без профессионального суждения ───

async def test_pending_lists_only_metrics_without_judgment(db_session):
    system = await _system(db_session)
    metrics = await _metrics(db_session)
    period = await _period(db_session, system, metrics)
    judged = metrics[0]
    db_session.add(ProfessionalJudgment(
        id=uuid.uuid4(), period_id=period.id, characteristic=judged.characteristic,
        subcharacteristic=judged.subcharacteristic, judgment_text="норма", author="qm",
    ))
    await db_session.flush()

    pending = await judgments_pending(db=db_session)
    pairs = {(r.characteristic, r.subcharacteristic) for r in pending}
    assert len(pending) == len(metrics) - 1
    assert (judged.characteristic, judged.subcharacteristic) not in pairs
    assert all(r.system_name == system.name and r.period == period.period for r in pending)


async def test_pending_row_disappears_after_judgment_saved(db_session):
    system = await _system(db_session)
    metrics = await _metrics(db_session)
    period = await _period(db_session, system, metrics)

    first = (await judgments_pending(db=db_session))[0]
    await save_judgments(
        period.id,
        [JudgmentIn(characteristic=first.characteristic, subcharacteristic=first.subcharacteristic,
                    judgment_text="просадка по релизу — план стабилизации")],
        db_session, USER,
    )
    after = await judgments_pending(db=db_session)
    assert (first.characteristic, first.subcharacteristic) not in {
        (r.characteristic, r.subcharacteristic) for r in after
    }
    assert len(after) == len(metrics) - 1


async def test_pending_takes_latest_period_only_unless_all_periods(db_session):
    system = await _system(db_session)
    metrics = await _metrics(db_session)
    old = await _period(db_session, system, metrics, quarter="Q4-2025")
    latest = await _period(db_session, system, metrics, quarter="Q1-2026")

    # По умолчанию — только последний период с оценкой (DEF-14: архив не дозаполняем).
    default_scope = await judgments_pending(db=db_session)
    assert {r.period for r in default_scope} == {"Q1-2026"}

    # all_periods=true — включая архивные кварталы.
    full_scope = await judgments_pending(all_periods=True, db=db_session)
    assert {r.period for r in full_scope} == {"Q4-2025", "Q1-2026"}
    assert len(full_scope) == 2 * len(metrics)

    # Точечный выбор периода перекрывает правило «последнего».
    only_old = await judgments_pending(period_id=old.id, db=db_session)
    assert {r.period for r in only_old} == {"Q4-2025"}
    assert str(latest.id) not in {r.period_id for r in only_old}


async def test_pending_worst_first_and_unmeasurable_on_top(db_session):
    system = await _system(db_session)
    metrics = await _metrics(db_session)
    period = await _period(db_session, system, metrics, x=0.8)
    # Одна метрика «невозможно измерить» (X не считается) и одна заведомо просевшая.
    values = (await db_session.execute(
        AssessmentValue.__table__.select().where(AssessmentValue.period_id == period.id)
    )).all()
    unmeasurable = await db_session.get(AssessmentValue, values[0].id)
    unmeasurable.calculated_x = None
    unmeasurable.quality_level = "Невозможно измерить"
    unmeasurable.unmeasurable = True
    unmeasurable.expert_comment = "нет источника данных"
    low = await db_session.get(AssessmentValue, values[1].id)
    low.calculated_x = 0.15
    await db_session.flush()

    pending = await judgments_pending(db=db_session)
    assert pending[0].score_pct == -1                       # «невозможно измерить» — первым
    assert pending[0].expert_comment == "нет источника данных"
    assert pending[1].score_pct == 15                       # затем самый низкий балл
    assert [r.score_pct for r in pending] == sorted(r.score_pct for r in pending)


async def test_pending_filters_by_system(db_session):
    metrics = await _metrics(db_session)
    core = await _system(db_session, name="АБС Core")
    crm = await _system(db_session, name="CRM ОПК")
    await _period(db_session, core, metrics)
    await _period(db_session, crm, metrics)

    only_crm = await judgments_pending(system="CRM ОПК", db=db_session)
    assert {r.system_name for r in only_crm} == {"CRM ОПК"}
    assert len(only_crm) == len(metrics)
