"""Тесты редактора весов (ТЗ v19 УК-04/05/07): валидация Σ=100 на каждом уровне, сохранение
правки одного профиля критичности без затрагивания двух других, предпросмотр эффекта на балл
портфеля без записи, и что правка ДЕЙСТВИТЕЛЬНО меняет Score систем нужного профиля (не только
хранится инертно — см. регресс test_recompute_applies_weights_not_flat_average).
"""
import uuid

from app.modules.assessment.models import AssessmentPeriod, AssessmentValue
from app.modules.quality import QUALITY_PAIRS, FormulaType, MetricCatalog, calculate_metric, map_to_level
from app.modules.quality.weight_versions import (
    ensure_active_version,
    get_active_version,
    preview_weight_edit,
    save_weight_edit,
    validate_weight_edit,
)
from app.modules.quality.weights import CHARACTERISTIC_WEIGHTS, DEFAULT_CHAR_WEIGHTS, DEFAULT_SUBCHAR_WITHIN_CHAR
from app.modules.systems import CriticalityClass, System
from app.shared.exceptions import ValidationError


def _valid_char_weights() -> dict[str, float]:
    return dict(DEFAULT_CHAR_WEIGHTS)


def _valid_subchar_within() -> dict[tuple[str, str], float]:
    return dict(DEFAULT_SUBCHAR_WITHIN_CHAR)


# ── validate_weight_edit (Σ=100 на каждом уровне, ошибка указывает строку) ──

def test_validate_accepts_correct_seed_values():
    assert validate_weight_edit(_valid_char_weights(), _valid_subchar_within()) == []


def test_validate_rejects_char_weight_sum_not_100():
    bad = _valid_char_weights()
    bad["Надёжность"] = bad["Надёжность"] + 10  # теперь Σu = 110
    errors = validate_weight_edit(bad, _valid_subchar_within())
    assert any("характеристик (u)" in e and "110" in e for e in errors)


def test_validate_rejects_subchar_sum_not_100_for_one_characteristic():
    bad = _valid_subchar_within()
    bad[("Надёжность", "Зрелость (плотность дефектов)")] += 5  # только «Надёжность» разъезжается
    errors = validate_weight_edit(_valid_char_weights(), bad)
    assert any("«Надёжность»" in e for e in errors)
    # Другие характеристики не задеты — их не должно быть в тексте ошибок.
    assert not any("«Защищённость»" in e for e in errors)


def test_validate_rejects_missing_characteristic():
    bad = _valid_char_weights()
    del bad["Переносимость"]
    errors = validate_weight_edit(bad, _valid_subchar_within())
    assert any("Переносимость" in e for e in errors)


def test_validate_rejects_unknown_subchar_pair():
    bad = _valid_subchar_within()
    bad[("Надёжность", "Несуществующая подхарактеристика")] = 1.0
    errors = validate_weight_edit(_valid_char_weights(), bad)
    assert any("Неизвестные подхарактеристики" in e for e in errors)


# ── save_weight_edit (сохраняет ОДИН профиль, версия/история) ──

async def test_save_weight_edit_updates_only_target_profile(db_session):
    await ensure_active_version(db_session)  # засеять базовую версию
    edited_char = _valid_char_weights()
    edited_char["Надёжность"] = 25.0
    edited_char["Сопровождаемость"] = CHARACTERISTIC_WEIGHTS["Сопровождаемость"] - 5.0  # сохраняем Σ=100

    version = await save_weight_edit(
        db_session, profile="BUSINESS CRITICAL", char_weights=edited_char,
        subchar_within=_valid_subchar_within(), note="тест правки", created_by=None,
    )
    assert version.is_active is True
    assert version.note == "тест правки"
    assert version.char_weights["BUSINESS CRITICAL"]["Надёжность"] == 25.0
    # Два других профиля не тронуты — остались на исходных значениях.
    assert version.char_weights["MISSION CRITICAL"]["Надёжность"] == CHARACTERISTIC_WEIGHTS["Надёжность"]
    assert version.char_weights["BUSINESS OPERATIONAL"]["Надёжность"] == CHARACTERISTIC_WEIGHTS["Надёжность"]

    # Старая версия деактивирована — ровно одна активная (инвариант версии).
    active = await get_active_version(db_session)
    assert active.id == version.id


async def test_ensure_active_version_does_not_revert_manual_edit(db_session):
    """Регресс 2026-08-17: ensure_active_version() раньше на КАЖДЫЙ вызов сверяла активную
    версию с хардкодным файлом и переиздавала её при расхождении — то есть правка редактора
    весов стиралась на следующей же загрузке дашборда/страницы редактора (обе зовут
    ensure_active_version). Живой прогон вскрыл это сразу после первого сохранения."""
    edited_char = _valid_char_weights()
    edited_char["Надёжность"] = 25.0
    edited_char["Переносимость"] = 0.0
    saved = await save_weight_edit(
        db_session, profile="MISSION CRITICAL", char_weights=edited_char,
        subchar_within=_valid_subchar_within(), note="правка", created_by=None,
    )

    # Имитация следующей загрузки страницы/дашборда — НЕ должна откатить правку.
    again = await ensure_active_version(db_session)
    assert again.id == saved.id
    assert again.char_weights["MISSION CRITICAL"]["Надёжность"] == 25.0


async def test_save_weight_edit_unknown_profile_rejected(db_session):
    await ensure_active_version(db_session)
    try:
        await save_weight_edit(
            db_session, profile="НЕИЗВЕСТНЫЙ", char_weights=_valid_char_weights(),
            subchar_within=_valid_subchar_within(), note=None, created_by=None,
        )
        assert False, "ожидался ValidationError"
    except ValidationError:
        pass


# ── Правка ДЕЙСТВИТЕЛЬНО меняет Score (не инертное хранение) ──

async def _system(db, name, criticality) -> System:
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


async def _period_all_reliability_high(db, system, metrics, quarter="Q2-2026") -> AssessmentPeriod:
    """Период, где ТОЛЬКО «Надёжность» на максимуме (100%), остальное — на минимуме (0%) —
    так вклад «Надёжности» в итоговый балл прямо пропорционален её весу u, разница видна сразу."""
    period = AssessmentPeriod(id=uuid.uuid4(), system_id=system.id, period=quarter, status="CALCULATED")
    db.add(period)
    await db.flush()
    for metric in metrics:
        formula = metric.formula_type.value
        want_high = metric.characteristic == "Надёжность"
        a, b = (100, 100) if (want_high == (formula == "DIRECT")) else (0, 100)
        real_x = calculate_metric(a, b, formula)
        db.add(AssessmentValue(
            id=uuid.uuid4(), period_id=period.id, metric_id=metric.id,
            val_a=a, val_b=b, calculated_x=real_x, quality_level=map_to_level(real_x),
            data_source="TEST",
        ))
    await db.flush()
    return period


async def test_preview_weight_edit_reports_score_delta_without_persisting(db_session):
    active_before = await ensure_active_version(db_session)
    system = await _system(db_session, "ИС-предпросмотр", CriticalityClass.BUSINESS_CRITICAL)
    metrics = await _metrics(db_session)
    await _period_all_reliability_high(db_session, system, metrics)

    # Поднимаем u(«Надёжность») до максимума в профиле BUSINESS CRITICAL — раз «Надёжность»
    # единственная измеренная на 100%, а остальные на 0%, рост её веса обязан поднять балл.
    edited_char = _valid_char_weights()
    boost = CHARACTERISTIC_WEIGHTS["Переносимость"]  # забираем вес у «Переносимости», чтобы Σ=100
    edited_char["Надёжность"] += boost
    edited_char["Переносимость"] -= boost

    report = await preview_weight_edit(
        db_session, profile="BUSINESS CRITICAL", char_weights=edited_char,
        subchar_within=_valid_subchar_within(),
    )
    assert report.applied is False
    assert len(report.changed) == 1
    assert report.changed[0].delta is not None and report.changed[0].delta > 0

    # Предпросмотр НЕ пишет — активная версия та же самая, что была до вызова.
    active_after = await get_active_version(db_session)
    assert active_after.id == active_before.id


async def test_save_weight_edit_only_affects_matching_profile_systems(db_session):
    await ensure_active_version(db_session)
    metrics = await _metrics(db_session)
    sys_bc = await _system(db_session, "ИС-BC", CriticalityClass.BUSINESS_CRITICAL)
    sys_mc = await _system(db_session, "ИС-MC", CriticalityClass.MISSION_CRITICAL)
    await _period_all_reliability_high(db_session, sys_bc, metrics, quarter="Q2-2026")
    await _period_all_reliability_high(db_session, sys_mc, metrics, quarter="Q2-2026")

    from app.modules.quality.weight_versions import combined_weights_for_version, _collect_raw_buckets, _apply_weights  # noqa: E501

    before_active = await get_active_version(db_session)
    before_weights = combined_weights_for_version(before_active)
    buckets = await _collect_raw_buckets(db_session)
    before_scores = {b.system_name: _apply_weights(b, before_weights).score for b in buckets}

    edited_char = _valid_char_weights()
    boost = CHARACTERISTIC_WEIGHTS["Переносимость"]
    edited_char["Надёжность"] += boost
    edited_char["Переносимость"] -= boost
    await save_weight_edit(
        db_session, profile="BUSINESS CRITICAL", char_weights=edited_char,
        subchar_within=_valid_subchar_within(), note=None, created_by=None,
    )

    after_active = await get_active_version(db_session)
    after_weights = combined_weights_for_version(after_active)
    buckets2 = await _collect_raw_buckets(db_session)
    after_scores = {b.system_name: _apply_weights(b, after_weights).score for b in buckets2}

    assert after_scores["ИС-BC"] != before_scores["ИС-BC"]      # свой профиль правки — изменился
    assert after_scores["ИС-MC"] == before_scores["ИС-MC"]      # чужой профиль — не задет
