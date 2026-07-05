"""Юнит-тесты движка контура СИИ по ГОСТ Р 59898-2021 (BL-001 E1).

Покрытие: ML-метрики (критерий приёмки 3), нормирование к baseline ± допуски
(критерии 4), интегральный Q с равными весами (критерий 5), каталог 4/8/37/7 (критерий 2).
"""
import pytest

from app.modules.quality.ai_calculation import aggregate, compute_metric, normalize_to_baseline
from app.modules.quality.ai_quality_model import (
    AI_CHARACTERISTICS,
    AI_GROUPS,
    AI_SPECIFIC_COUNT,
    AI_SUB_INDEX,
    AI_TOTAL_SUBS,
    METRIC_KINDS,
    ai_model_tree,
)


# --- Каталог (критерий приёмки 2, BL-003) ---

def test_catalog_shape_4_8_37_7():
    assert len(AI_GROUPS) == 4
    assert len(AI_CHARACTERISTICS) == 8
    assert AI_TOTAL_SUBS == 37
    assert AI_SPECIFIC_COUNT == 7


def test_catalog_machine_readable_kinds():
    # У каждой субхарактеристики валидный metric_kind и схема входов (BL-003).
    for (char, sub), meta in AI_SUB_INDEX.items():
        assert meta["metric_kind"] in METRIC_KINDS, (char, sub)
        assert meta["inputs_schema"] == METRIC_KINDS[meta["metric_kind"]]
        assert meta["hint"]


def test_model_tree_serialization():
    tree = ai_model_tree()
    assert len(tree) == 4
    subs = [s for g in tree for c in g["characteristics"] for s in c["subs"]]
    assert len(subs) == 37
    assert sum(1 for s in subs if s["is_ai_specific"]) == 7


# --- ML-метрики (критерий 3) ---

def test_ratio_metrics():
    assert compute_metric("RATIO_DIRECT", {"A": 8, "B": 10}) == 0.8
    assert compute_metric("RATIO_INVERSE", {"A": 2, "B": 10}) == 0.8
    assert compute_metric("RATIO_DIRECT", {"A": 5, "B": 0}) is None      # деление на ноль
    assert compute_metric("RATIO_DIRECT", {"A": 15, "B": 10}) == 1.0     # клип сверху


def test_classification_metrics():
    inputs = {"TP": 80, "TN": 90, "FP": 10, "FN": 20}
    assert compute_metric("ACCURACY", inputs) == pytest.approx(0.85)
    assert compute_metric("PRECISION", inputs) == pytest.approx(80 / 90)
    assert compute_metric("RECALL", inputs) == pytest.approx(0.8)
    assert compute_metric("SPECIFICITY", inputs) == pytest.approx(0.9)
    f1 = compute_metric("F1", inputs)
    pr, rc = 80 / 90, 0.8
    assert f1 == pytest.approx(2 * pr * rc / (pr + rc), abs=1e-4)


def test_classification_requires_all_inputs():
    assert compute_metric("ACCURACY", {"TP": 1, "TN": 2}) is None
    assert compute_metric("F1", {"TP": 0, "FP": 0, "FN": 0}) is None     # знаменатели 0


def test_expert_scale_and_unknown_kind():
    assert compute_metric("EXPERT_SCALE", {"score": 75}) == 0.75
    assert compute_metric("EXPERT_SCALE", {"score": 150}) == 1.0          # клип
    assert compute_metric("MSE", {"y": [1], "y_hat": [1]}) is None        # E2 — не в E1


# --- Baseline + допуски (критерий 4) ---

def test_normalize_exact_baseline_is_one():
    x, ok = normalize_to_baseline(0.9, baseline=0.9, tol_low=0.05, tol_high=0.05)
    assert x == 1.0 and ok is True


def test_normalize_inside_and_outside_tolerance():
    # внутри допуска: отклонение 0.02 при ε=0.05 → X = 1 − 0.4 = 0.6, в допуске
    x, ok = normalize_to_baseline(0.88, baseline=0.9, tol_low=0.05, tol_high=0.05)
    assert x == pytest.approx(0.6) and ok is True
    # на границе: X = 0, но формально в допуске
    x, ok = normalize_to_baseline(0.85, baseline=0.9, tol_low=0.05, tol_high=0.05)
    assert x == 0.0 and ok is True
    # вне допуска
    x, ok = normalize_to_baseline(0.8, baseline=0.9, tol_low=0.05, tol_high=0.05)
    assert x == 0.0 and ok is False


def test_normalize_asymmetric_and_no_baseline():
    # асимметричные допуски: превышение с ε⁺=0.1
    x, ok = normalize_to_baseline(0.95, baseline=0.9, tol_low=0.02, tol_high=0.1)
    assert ok is True and x == pytest.approx(0.5)
    # эталон не задан → X = значение, вердикт не выносится
    x, ok = normalize_to_baseline(0.7, baseline=None, tol_low=None, tol_high=None)
    assert x == 0.7 and ok is None


# --- Интегральный Q (критерий 5) ---

def test_aggregate_equal_weights():
    rows = [
        {"characteristic": "Надёжность", "subcharacteristic": "Робастность (robustness)", "normalized_x": 0.8},
        {"characteristic": "Надёжность", "subcharacteristic": "Стабильность (maturity)", "normalized_x": 0.6},
        {"characteristic": "Защищённость", "subcharacteristic": "Приватность (privacy)", "normalized_x": 1.0},
        {"characteristic": "Защищённость", "subcharacteristic": "Целостность", "normalized_x": None},  # не в свёртке
    ]
    out = aggregate(rows)
    # Надёжность K = (0.8+0.6)/2 = 0.7; Защищённость K = 1.0; Q = 0.85
    assert out["q"] == pytest.approx(0.85)
    assert out["level"] == "Высокий уровень"
    assert {c["title"]: c["score"] for c in out["characteristics"]} == {
        "Надёжность": 0.7, "Защищённость": 1.0,
    }


def test_aggregate_empty():
    out = aggregate([{"characteristic": "X", "subcharacteristic": "Y", "normalized_x": None}])
    assert out["q"] is None and out["level"] == "Невозможно измерить"
