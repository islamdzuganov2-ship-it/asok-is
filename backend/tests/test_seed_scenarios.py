"""Тесты сценарного сида демо-данных (app.scripts.seed_demo) — качество данных для LLM.

Проверяется ролевой подход: детерминированность, сценарные аномалии для CIO/CTO,
содержание суждений МК (факт → влияние → мера → ответственный → эскалация).
"""
from app.modules.systems import CriticalityClass
from app.scripts.seed_demo import (
    QUARTERS,
    SCENARIOS,
    UNMEASURABLE,
    _ai_inputs,
    judgment_text,
    target_x,
)
from app.modules.quality.ai_calculation import compute_metric


def test_target_x_deterministic():
    a = target_x("CRM_OPK", "Сопровождаемость", "Модульность", 3)
    b = target_x("CRM_OPK", "Сопровождаемость", "Модульность", 3)
    assert a == b
    assert 0.02 <= a <= 0.99


def test_crm_degradation_trend():
    # CRM ОПК деградирует: последний квартал хуже первого по проблемной характеристике.
    first = target_x("CRM_OPK", "Сопровождаемость", "Модульность", 0)
    last = target_x("CRM_OPK", "Сопровождаемость", "Модульность", len(QUARTERS) - 1)
    assert last < first


def test_abs_core_reliability_anomaly_q4_2025():
    # Инцидент P1: просадка «Надёжности» в Q4-2025 и восстановление в Q1-2026.
    q_idx = QUARTERS.index("Q4-2025")
    dip = target_x("ABS_CORE", "Надёжность", "Доступность (uptime)", q_idx)
    recovered = target_x("ABS_CORE", "Надёжность", "Доступность (uptime)", q_idx + 1)
    assert recovered - dip >= 0.2  # аномалия заметна на дашборде (≥ 20 п.п.)


def test_hr_portal_growth():
    first = target_x("HR_PORTAL", "Удобство использования", "Изучаемость", 0)
    last = target_x("HR_PORTAL", "Удобство использования", "Изучаемость", len(QUARTERS) - 1)
    assert last > first


def test_aokis_focus_functional_suitability():
    # АОКИС: «Функциональная пригодность» — слабое место (связь с карточкой суждений, ТЗ v14 §4).
    fp = target_x("AOKIS", "Функциональная пригодность", "Функциональная полнота", 5)
    other = target_x("AOKIS", "Защищённость", "Целостность", 5)
    assert fp < other


def test_judgment_text_role_content_critical():
    text = judgment_text("АБС Core", "Надёжность", "Доступность (uptime)", 45,
                         CriticalityClass.MISSION_CRITICAL)
    # Суждение МК: влияние, мера, ответственный, эскалация на уровень CIO (MISSION CRITICAL).
    assert "Влияние" in text and "Мера" in text
    assert "Сидоров К.М." in text  # ответственный по «Надёжности»
    assert "CIO" in text           # эскалация по критичности


def test_judgment_text_ok_level_has_no_escalation():
    text = judgment_text("АБС Core", "Защищённость", "Целостность", 92,
                         CriticalityClass.MISSION_CRITICAL)
    assert "эскалация" not in text.lower()
    assert "целевой уровень выдержан" in text


def test_scenarios_and_unmeasurable_wellformed():
    assert set(SCENARIOS) == {"ABS_CORE", "CRM_OPK", "HR_PORTAL", "AOKIS"}
    for code, sub in UNMEASURABLE:
        assert code == "HR_PORTAL"  # «невозможно измерить» — только HR Portal (сценарий)


def test_ai_inputs_hit_target():
    # Входы метрик СИИ дают значение, близкое к целевому x.
    for kind in ("ACCURACY", "RECALL", "RATIO_DIRECT", "RATIO_INVERSE", "EXPERT_SCALE"):
        x = 0.87
        raw = compute_metric(kind, _ai_inputs(kind, x))
        assert raw is not None
        assert abs(raw - x) < 0.05, f"{kind}: {raw} vs {x}"
