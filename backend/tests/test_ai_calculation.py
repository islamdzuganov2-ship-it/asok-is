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
    assert compute_metric("UNKNOWN_KIND", {"A": 1}) is None               # неизвестный вид


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


# --- E2: расширенные метрики (MSE/MAE/AUC/NDCG/PSNR/SSIM) ---

def test_mse_mae():
    inputs = {"y": [1, 2, 3], "y_hat": [1, 2, 5]}
    assert compute_metric("MSE", inputs) == pytest.approx(4 / 3, abs=1e-3)
    assert compute_metric("MAE", inputs) == pytest.approx(2 / 3, abs=1e-3)
    # CSV-строки тоже принимаются (ввод с фронта)
    assert compute_metric("MAE", {"y": "1,2,3", "y_hat": "1,2,5"}) == pytest.approx(2 / 3, abs=1e-3)
    assert compute_metric("MSE", {"y": [1], "y_hat": [1, 2]}) is None  # разная длина


def test_auc_trapezoid():
    # Идеальный классификатор: ROC (0,0)→(0,1)→(1,1) → AUC = 1
    assert compute_metric("AUC_ROC", {"curve": [[0, 0], [0, 1], [1, 1]]}) == 1.0
    # Случайный: диагональ → 0.5
    assert compute_metric("AUC_ROC", {"curve": [[0, 0], [1, 1]]}) == 0.5
    assert compute_metric("AUC_ROC", {"curve": [[0, 0]]}) is None  # < 2 точек


def test_ndcg():
    # Идеальный порядок → 1.0; перестановка ухудшает
    assert compute_metric("NDCG", {"rel": [3, 2, 1]}) == 1.0
    worse = compute_metric("NDCG", {"rel": [1, 2, 3]})
    assert worse is not None and worse < 1.0
    assert compute_metric("NDCG", {"rel": [0, 0, 0]}) == 0.0  # IDCG = 0


def test_psnr():
    # Идентичные изображения → капается на 100 дБ
    assert compute_metric("PSNR", {"I": [10, 20], "I_hat": [10, 20]}) == 100.0
    v = compute_metric("PSNR", {"I": [0, 0, 0, 0], "I_hat": [10, 10, 10, 10], "max_i": 255})
    assert v == pytest.approx(10 * __import__("math").log10(255 ** 2 / 100), abs=1e-3)


def test_ssim():
    assert compute_metric("SSIM", {"I": [10, 200, 30, 44], "I_hat": [10, 200, 30, 44]}) == 1.0
    v = compute_metric("SSIM", {"I": [0, 50, 100, 150], "I_hat": [150, 100, 50, 0]})
    assert v is not None and v < 0.5  # антикоррелированные — низкое сходство


# --- E2: взвешенная свёртка (формулы 3–8) ---

def test_aggregate_weighted_characteristics():
    rows = [
        {"characteristic": "Надёжность", "subcharacteristic": "Робастность (robustness)", "normalized_x": 0.4},
        {"characteristic": "Защищённость", "subcharacteristic": "Приватность (privacy)", "normalized_x": 1.0},
    ]
    # Равные веса → 0.7; вес 0.9/0.1 → 0.4·0.9 + 1.0·0.1 = 0.46
    assert aggregate(rows)["q"] == pytest.approx(0.7)
    out = aggregate(rows, char_weights={"Надёжность": 0.9, "Защищённость": 0.1})
    assert out["q"] == pytest.approx(0.46) and out["weighted"] is True


def test_aggregate_weighted_subs_and_renormalization():
    rows = [
        {"characteristic": "Надёжность", "subcharacteristic": "A", "normalized_x": 1.0},
        {"characteristic": "Надёжность", "subcharacteristic": "B", "normalized_x": 0.0},
    ]
    # Вес субхарактеристик 0.8/0.2 → K = 0.8
    out = aggregate(rows, sub_weights={"Надёжность": {"A": 0.8, "B": 0.2}})
    assert out["characteristics"][0]["score"] == pytest.approx(0.8)
    # Частичные веса (нет веса для B из набора; вес есть только у A) → ренормировка на присутствующие
    out2 = aggregate(rows, sub_weights={"Надёжность": {"A": 0.5, "C": 0.5}})
    assert out2["characteristics"][0]["score"] == pytest.approx(1.0)  # только A с весом → 1.0
