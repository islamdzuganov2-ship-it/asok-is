"""Расчётный движок контура СИИ по ГОСТ Р 59898-2021 (BL-001, E1+E2).

1) compute_metric(metric_kind, inputs) → сырое значение метрики или None
   («невозможно вычислить»: нет входов / нулевой знаменатель).
   E1: A/B, ACCURACY/PRECISION/RECALL/SPECIFICITY/F1, EXPERT_SCALE — значения в [0,1].
   E2: MSE/MAE (массивы y/ŷ), AUC_ROC/AUC_PRC (трапеции по точкам кривой), NDCG (DCG/IDCG),
   PSNR (дБ), SSIM — MSE/MAE/PSNR вне [0,1], приводятся к X нормировкой к baseline.
2) normalize_to_baseline(value, baseline, tol_low, tol_high) → (X∈[0,1], conformant):
   • критерий соответствия (п. 7.1.3.3):  m_l − ε⁻ ≤ m_f ≤ m_l + ε⁺;
   • нормирование (п. 7.2.2.3): X = 1 при совпадении с базовым значением, линейно
     убывает до 0 на границе допуска и дальше; без baseline X = clip(value, 0, 1).
3) aggregate(rows, char_weights, sub_weights) → свёртка снизу вверх по формулам 3–8:
   c = Σ vⱼmⱼ → K = Σ wᵢcᵢ → Q = Σ uₖKₖ; веса задаются на период (Σ=1, E2),
   при отсутствии — равные (E1-поведение). Частичные веса ренормируются по внесённым узлам.

Уровень для Q переиспользует шкалу ISO-контура (map_to_level).
"""
from __future__ import annotations

import math
from collections import defaultdict
from typing import Any

from app.modules.quality.calculation import map_to_level

_CLASSIFICATION_FIELDS = ("TP", "TN", "FP", "FN")


def _num(inputs: dict[str, Any], key: str) -> float | None:
    """Числовое поле входов (≥0) или None."""
    value = (inputs or {}).get(key)
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number >= 0 else None


def _ratio(numerator: float | None, denominator: float | None) -> float | None:
    if numerator is None or denominator is None or denominator == 0:
        return None
    return max(0.0, min(1.0, numerator / denominator))


def compute_metric(metric_kind: str, inputs: dict[str, Any] | None) -> float | None:
    """Сырое значение метрики в [0,1] по виду и входам; None — вычислить нельзя."""
    inputs = inputs or {}
    tp, tn = _num(inputs, "TP"), _num(inputs, "TN")
    fp, fn = _num(inputs, "FP"), _num(inputs, "FN")

    if metric_kind == "RATIO_DIRECT":
        return _ratio(_num(inputs, "A"), _num(inputs, "B"))
    if metric_kind == "RATIO_INVERSE":
        direct = _ratio(_num(inputs, "A"), _num(inputs, "B"))
        return None if direct is None else round(1.0 - direct, 4)
    if metric_kind == "ACCURACY":
        if None in (tp, tn, fp, fn):
            return None
        return _ratio(tp + tn, tp + tn + fp + fn)
    if metric_kind == "PRECISION":
        return None if None in (tp, fp) else _ratio(tp, tp + fp)
    if metric_kind == "RECALL":
        return None if None in (tp, fn) else _ratio(tp, tp + fn)
    if metric_kind == "SPECIFICITY":
        return None if None in (tn, fp) else _ratio(tn, tn + fp)
    if metric_kind == "F1":
        if None in (tp, fp, fn):
            return None
        precision = _ratio(tp, tp + fp)
        recall = _ratio(tp, tp + fn)
        if precision is None or recall is None or (precision + recall) == 0:
            return 0.0 if (precision is not None and recall is not None) else None
        return round(2 * precision * recall / (precision + recall), 4)
    if metric_kind == "EXPERT_SCALE":
        score = _num(inputs, "score")
        return None if score is None else max(0.0, min(1.0, score / 100.0))

    # --- E2: регрессия, ранжирование, кривые, изображения ---
    if metric_kind in ("MSE", "MAE"):
        y = _arr(inputs, "y")
        y_hat = _arr(inputs, "y_hat")
        if y is None or y_hat is None or len(y) != len(y_hat) or not y:
            return None
        if metric_kind == "MSE":
            return round(sum((a - b) ** 2 for a, b in zip(y, y_hat)) / len(y), 4)
        return round(sum(abs(a - b) for a, b in zip(y, y_hat)) / len(y), 4)
    if metric_kind in ("AUC_ROC", "AUC_PRC"):
        curve = _curve(inputs, "curve")
        if curve is None or len(curve) < 2:
            return None
        pts = sorted(curve)
        area = sum((x2 - x1) * (y1 + y2) / 2 for (x1, y1), (x2, y2) in zip(pts, pts[1:]))
        return round(max(0.0, min(1.0, area)), 4)
    if metric_kind == "NDCG":
        rel = _arr(inputs, "rel")
        if rel is None or not rel:
            return None
        dcg = sum(r / math.log2(i + 2) for i, r in enumerate(rel))
        idcg = sum(r / math.log2(i + 2) for i, r in enumerate(sorted(rel, reverse=True)))
        return 0.0 if idcg == 0 else round(max(0.0, min(1.0, dcg / idcg)), 4)
    if metric_kind == "PSNR":
        i1, i2 = _arr(inputs, "I"), _arr(inputs, "I_hat")
        if i1 is None or i2 is None or len(i1) != len(i2) or not i1:
            return None
        max_i = _num(inputs, "max_i") or 255.0
        mse = sum((a - b) ** 2 for a, b in zip(i1, i2)) / len(i1)
        if mse == 0:
            return 100.0  # идеальная реконструкция: ограничиваем сверху (∞ дБ)
        return round(min(100.0, 10.0 * math.log10((max_i ** 2) / mse)), 4)
    if metric_kind == "SSIM":
        i1, i2 = _arr(inputs, "I"), _arr(inputs, "I_hat")
        if i1 is None or i2 is None or len(i1) != len(i2) or not i1:
            return None
        length = _num(inputs, "max_i") or 255.0
        n = len(i1)
        mu_x, mu_y = sum(i1) / n, sum(i2) / n
        var_x = sum((a - mu_x) ** 2 for a in i1) / n
        var_y = sum((b - mu_y) ** 2 for b in i2) / n
        cov = sum((a - mu_x) * (b - mu_y) for a, b in zip(i1, i2)) / n
        c1, c2 = (0.01 * length) ** 2, (0.03 * length) ** 2
        ssim = ((2 * mu_x * mu_y + c1) * (2 * cov + c2)) / ((mu_x ** 2 + mu_y ** 2 + c1) * (var_x + var_y + c2))
        return round(max(0.0, min(1.0, ssim)), 4)
    return None  # неизвестный вид


def _arr(inputs: dict[str, Any], key: str) -> list[float] | None:
    """Числовой массив из входов (list | строка CSV) или None."""
    value = (inputs or {}).get(key)
    if isinstance(value, str):
        value = [p for p in value.replace(";", ",").split(",") if p.strip()]
    if not isinstance(value, list):
        return None
    try:
        return [float(v) for v in value]
    except (TypeError, ValueError):
        return None


def _curve(inputs: dict[str, Any], key: str) -> list[tuple[float, float]] | None:
    """Кривая как список точек [[x,y],…] для AUC; None при некорректном формате."""
    value = (inputs or {}).get(key)
    if not isinstance(value, list):
        return None
    try:
        pts = [(float(p[0]), float(p[1])) for p in value]
    except (TypeError, ValueError, IndexError):
        return None
    return pts


def normalize_to_baseline(
    value: float,
    baseline: float | None,
    tol_low: float | None,
    tol_high: float | None,
) -> tuple[float, bool | None]:
    """Нормировка к базовому значению (п. 7.2.2.3) + вердикт соответствия (п. 7.1.3.3).

    Без baseline (эталон не задан) → X = value, conformant = None («не проверялось»).
    Допуск 0 в стороне отклонения → вне допуска при любом отклонении в эту сторону.
    """
    if baseline is None:
        return round(max(0.0, min(1.0, value)), 4), None

    eps_low = max(0.0, tol_low or 0.0)
    eps_high = max(0.0, tol_high or 0.0)
    conformant = (baseline - eps_low) <= value <= (baseline + eps_high)

    deviation = value - baseline
    if deviation == 0:
        return 1.0, True
    tolerance = eps_high if deviation > 0 else eps_low
    if tolerance == 0:
        return 0.0, conformant
    x = 1.0 - abs(deviation) / tolerance
    return round(max(0.0, min(1.0, x)), 4), conformant


def _weighted_mean(scores: dict[str, float], weights: dict[str, float] | None) -> float:
    """Σ wᵢ·xᵢ по заданным весам с ренормировкой на присутствующие узлы; без весов — среднее.

    ГОСТ требует Σ весов = 1 по выбранному набору (валидируется при сохранении весов);
    если часть узлов набора ещё не измерена, веса присутствующих ренормируются.
    """
    if not scores:
        return 0.0
    if weights:
        present = {k: w for k, w in weights.items() if k in scores and w > 0}
        total = sum(present.values())
        if total > 0:
            return sum(scores[k] * (w / total) for k, w in present.items())
    return sum(scores.values()) / len(scores)


def aggregate(
    rows: list[dict],
    char_weights: dict[str, float] | None = None,
    sub_weights: dict[str, dict[str, float]] | None = None,
) -> dict:
    """Свёртка по формулам 3–8: c = Σ vⱼmⱼ → K = Σ wᵢcᵢ → Q = Σ uₖKₖ.

    rows: {characteristic, subcharacteristic, normalized_x}; None-строки не входят в свёртку.
    char_weights: {характеристика: uₖ}; sub_weights: {характеристика: {субхар.: wᵢ}}.
    Без весов — равные (E1-поведение). Возврат: {"q", "level", "characteristics", "weighted"}.
    """
    by_char: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
    for row in rows:
        x = row.get("normalized_x")
        if x is None:
            continue
        by_char[row["characteristic"]][row["subcharacteristic"]].append(float(x))

    characteristics = []
    char_scores: dict[str, float] = {}
    for char_title, subs in by_char.items():
        # c_j = Σ v·m: метрики внутри субхарактеристики — среднее (E1/E2: одна метрика на субхар.)
        sub_scores = {sub: sum(vals) / len(vals) for sub, vals in subs.items()}
        k = _weighted_mean(sub_scores, (sub_weights or {}).get(char_title))  # K_i = Σ w·c
        char_scores[char_title] = k
        characteristics.append({
            "title": char_title,
            "score": round(k, 4),
            "subs_measured": len(sub_scores),
        })

    if not characteristics:
        return {"q": None, "level": "Невозможно измерить", "characteristics": [], "weighted": False}

    q = _weighted_mean(char_scores, char_weights)  # Q = Σ u·K
    weighted = bool(char_weights) or bool(sub_weights)
    return {"q": round(q, 4), "level": map_to_level(q), "characteristics": characteristics, "weighted": weighted}
