"""Расчётный движок контура СИИ по ГОСТ Р 59898-2021 (BL-001, E1).

1) compute_metric(metric_kind, inputs) → сырое значение метрики в [0,1] или None
   («невозможно вычислить»: нет входов / нулевой знаменатель).
2) normalize_to_baseline(value, baseline, tol_low, tol_high) → (X∈[0,1], conformant):
   • критерий соответствия (п. 7.1.3.3):  m_l − ε⁻ ≤ m_f ≤ m_l + ε⁺;
   • нормирование (п. 7.2.2.3): X = 1 при совпадении с базовым значением, линейно
     убывает до 0 на границе допуска и дальше; без baseline X = само значение (E1-fallback).
3) aggregate(rows) → свёртка снизу вверх с РАВНЫМИ весами (E1):
   субхарактеристика = среднее её метрик → характеристика → интегральный Q ∈ [0,1]
   (формулы 3–8 стандарта с u=v=w=1/N; настраиваемые веса — этап E2).

Уровень для Q переиспользует шкалу ISO-контура (map_to_level).
"""
from __future__ import annotations

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
    return None  # виды E2 (MSE/AUC/NDCG/PSNR/SSIM…) — не поддержаны в E1


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


def aggregate(rows: list[dict]) -> dict:
    """Свёртка E1 (равные веса): строки {characteristic, subcharacteristic, normalized_x}.

    Строки с normalized_x=None (невозможно измерить/не рассчитано) в свёртку не входят.
    Возврат: {"q": float|None, "level": str, "characteristics": [{title, score, subs_measured}]}.
    """
    by_char: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
    for row in rows:
        x = row.get("normalized_x")
        if x is None:
            continue
        by_char[row["characteristic"]][row["subcharacteristic"]].append(float(x))

    characteristics = []
    for char_title, subs in by_char.items():
        sub_scores = [sum(vals) / len(vals) for vals in subs.values()]  # c_j = Σ v·m (v=1/L)
        k = sum(sub_scores) / len(sub_scores)                           # K_i = Σ w·c (w=1/N)
        characteristics.append({
            "title": char_title,
            "score": round(k, 4),
            "subs_measured": len(sub_scores),
        })

    if not characteristics:
        return {"q": None, "level": "Невозможно измерить", "characteristics": []}

    q = sum(c["score"] for c in characteristics) / len(characteristics)  # Q = Σ u·K (u=1/M)
    return {"q": round(q, 4), "level": map_to_level(q), "characteristics": characteristics}
