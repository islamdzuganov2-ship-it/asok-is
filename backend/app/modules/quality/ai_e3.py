"""Контур СИИ по ГОСТ Р 59898-2021, этап E3 (BL-001) — чистые функции без БД.

Стандарт (разд. 7.2, 9) требует помимо измерения метрик:
  • требования к тестовому набору данных и критерий выбросов — `detect_outliers`;
  • паритет тестовой и эксплуатационной сред (табл. 3) — перечень факторов `ENV_PARITY_FACTORS`
    и сводка `parity_summary`;
  • экспертную ГРУППУ с критерием согласованности — коэффициент конкордации Кендалла W с
    проверкой значимости по χ² (`kendall_w`);
  • сравнение нескольких СИИ в единых шкалах (п. 7.2.2.5) — `compare_on_common_scales`.
"""
from __future__ import annotations

import math
from statistics import mean, median, pstdev

from app.modules.quality.ai_calculation import aggregate

# ── Выбросы (разд. 9: «критерий выбросов» тестового набора) ──
OUTLIER_IQR = "IQR"          # вне [Q1 − k·IQR; Q3 + k·IQR], k = 1.5 по умолчанию (Тьюки)
OUTLIER_ZSCORE = "ZSCORE"    # |x − μ| / σ > k, k = 3 по умолчанию
OUTLIER_METHODS = {OUTLIER_IQR: 1.5, OUTLIER_ZSCORE: 3.0}


def _quantile(sorted_values: list[float], q: float) -> float:
    """Квантиль с линейной интерполяцией (как numpy «linear»)."""
    if len(sorted_values) == 1:
        return sorted_values[0]
    pos = (len(sorted_values) - 1) * q
    lo = math.floor(pos)
    hi = math.ceil(pos)
    return sorted_values[lo] + (sorted_values[hi] - sorted_values[lo]) * (pos - lo)


def detect_outliers(values: list[float], method: str = OUTLIER_IQR, k: float | None = None) -> dict:
    """Выбросы в числовом признаке тестового набора: границы, число, доля, индексы.

    Метод и порог фиксируются в метаданных набора — чтобы результат был воспроизводим тем,
    кто проверяет оценку (критерий выбросов — часть описания набора, разд. 9)."""
    method = method.upper()
    if method not in OUTLIER_METHODS:
        raise ValueError(f"Неизвестный метод выбросов: {method}")
    k = OUTLIER_METHODS[method] if k is None else float(k)
    xs = [float(v) for v in values if v is not None and not (isinstance(v, float) and math.isnan(v))]
    if len(xs) < 3:
        return {"method": method, "k": k, "n": len(xs), "count": 0, "share": 0.0,
                "lower": None, "upper": None, "indices": [], "note": "меньше трёх значений — выбросы не оцениваются"}
    if method == OUTLIER_IQR:
        s = sorted(xs)
        q1, q3 = _quantile(s, 0.25), _quantile(s, 0.75)
        iqr = q3 - q1
        lower, upper = q1 - k * iqr, q3 + k * iqr
    else:
        mu, sigma = mean(xs), pstdev(xs)
        if sigma == 0:
            lower = upper = mu
        else:
            lower, upper = mu - k * sigma, mu + k * sigma
    indices = [i for i, x in enumerate(xs) if x < lower or x > upper]
    return {"method": method, "k": k, "n": len(xs), "count": len(indices),
            "share": round(len(indices) / len(xs), 4), "lower": round(lower, 6), "upper": round(upper, 6),
            "indices": indices[:1000], "median": median(xs), "note": None}


# ── Паритет сред (табл. 3 стандарта): факторы, по которым тестовая среда должна совпадать с эксплуатационной ──
ENV_PARITY_FACTORS: list[tuple[str, str]] = [
    ("hardware", "Аппаратная платформа (CPU/GPU, память)"),
    ("system_software", "Системное ПО, фреймворки и версии библиотек"),
    ("model_version", "Версия модели, веса и гиперпараметры"),
    ("configuration", "Конфигурация и параметры запуска (пороги, батчи)"),
    ("input_data", "Входные данные: источники, форматы, распределение признаков"),
    ("preprocessing", "Пред- и постобработка данных"),
    ("integrations", "Сетевое окружение и смежные системы"),
    ("load_profile", "Нагрузка и режим работы (пики, параллельность)"),
]
PARITY_MATCH = "MATCH"            # совпадает
PARITY_ACCEPTABLE = "ACCEPTABLE"  # отличается, но отличие обосновано и не влияет на метрики
PARITY_MISMATCH = "MISMATCH"      # отличается — результаты испытаний на прод не переносятся
PARITY_STATUSES = (PARITY_MATCH, PARITY_ACCEPTABLE, PARITY_MISMATCH)


def parity_summary(rows: list[dict]) -> dict:
    """Паритет сред выполнен, если ВСЕ факторы табл. 3 заполнены и нет расхождений без
    обоснования. Незаполненный фактор — это не «совпадает», а «не проверено»."""
    by_factor = {r["factor"]: r for r in rows}
    missing = [code for code, _ in ENV_PARITY_FACTORS if code not in by_factor]
    mismatches = [r["factor"] for r in rows if r.get("status") == PARITY_MISMATCH]
    unjustified = [r["factor"] for r in rows
                   if r.get("status") == PARITY_ACCEPTABLE and not (r.get("justification") or "").strip()]
    ok = not missing and not mismatches and not unjustified
    return {"ok": ok, "missing": missing, "mismatches": mismatches, "unjustified": unjustified,
            "checked": len(ENV_PARITY_FACTORS) - len(missing), "total": len(ENV_PARITY_FACTORS)}


# ── Экспертная группа: конкордация Кендалла (критерий согласованности) ──
KENDALL_THRESHOLD = 0.5   # W ≥ 0.5 — согласованность достаточная (типовая граница для экспертиз)
ALPHA = 0.05


def _ranks(scores: list[float]) -> tuple[list[float], float]:
    """Ранги по убыванию оценки (1 — лучший), связки — средним рангом; поправка T = Σ(t³ − t)."""
    order = sorted(range(len(scores)), key=lambda i: -scores[i])
    ranks = [0.0] * len(scores)
    ties = 0.0
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and scores[order[j + 1]] == scores[order[i]]:
            j += 1
        avg = (i + j) / 2 + 1
        for idx in order[i:j + 1]:
            ranks[idx] = avg
        t = j - i + 1
        if t > 1:
            ties += t ** 3 - t
        i = j + 1
    return ranks, ties


def _gammainc_upper_regularized(a: float, x: float) -> float:
    """Q(a, x) = Γ(a, x)/Γ(a) — ряд при x < a+1, цепная дробь иначе (Numerical Recipes)."""
    if x <= 0:
        return 1.0
    gln = math.lgamma(a)
    if x < a + 1:
        ap, s, d = a, 1.0 / a, 1.0 / a
        for _ in range(500):
            ap += 1
            d *= x / ap
            s += d
            if abs(d) < abs(s) * 1e-14:
                break
        return max(0.0, 1.0 - s * math.exp(-x + a * math.log(x) - gln))
    b = x + 1 - a
    c = 1 / 1e-300
    d = 1 / b
    h = d
    for i in range(1, 500):
        an = -i * (i - a)
        b += 2
        d = an * d + b
        d = 1e-300 if abs(d) < 1e-300 else d
        c = b + an / c
        c = 1e-300 if abs(c) < 1e-300 else c
        d = 1 / d
        delta = d * c
        h *= delta
        if abs(delta - 1) < 1e-14:
            break
    return min(1.0, math.exp(-x + a * math.log(x) - gln) * h)


def chi2_sf(x: float, df: int) -> float:
    """P(χ²_df ≥ x) — p-значение критерия значимости конкордации."""
    return _gammainc_upper_regularized(df / 2, x / 2)


def kendall_w(scores: dict[str, dict[str, float]], threshold: float = KENDALL_THRESHOLD) -> dict:
    """Коэффициент конкордации Кендалла W для m экспертов и n объектов (субхарактеристик).

    scores: {эксперт: {объект: оценка}}. В расчёт идут только объекты, оценённые ВСЕМИ
    экспертами (иначе ранги несравнимы). W = 12S / (m²(n³ − n) − m·ΣT), S — сумма квадратов
    отклонений сумм рангов от среднего; значимость — χ² = m(n − 1)W с n − 1 степенями свободы.
    Согласованность признаётся при W ≥ порога И p < 0.05: высокий W на трёх объектах может
    оказаться случайным."""
    experts = [e for e, s in scores.items() if s]
    m = len(experts)
    common = sorted(set.intersection(*(set(scores[e]) for e in experts))) if experts else []
    n = len(common)
    base = {"m": m, "n": n, "objects": common, "threshold": threshold}
    if m < 2 or n < 2:
        return {**base, "w": None, "chi2": None, "df": None, "p_value": None, "consistent": False,
                "rank_sums": {}, "means": {}, "note": "нужно не меньше двух экспертов и двух общих объектов"}
    rank_sums = {o: 0.0 for o in common}
    ties_total = 0.0
    for e in experts:
        ranks, ties = _ranks([float(scores[e][o]) for o in common])
        ties_total += ties
        for o, r in zip(common, ranks):
            rank_sums[o] += r
    mean_sum = m * (n + 1) / 2
    s = sum((rs - mean_sum) ** 2 for rs in rank_sums.values())
    denom = m ** 2 * (n ** 3 - n) - m * ties_total
    w = 12 * s / denom if denom > 0 else 1.0
    chi2 = m * (n - 1) * w
    p = chi2_sf(chi2, n - 1)
    means = {o: round(sum(float(scores[e][o]) for e in experts) / m, 4) for o in common}
    return {**base, "w": round(w, 4), "chi2": round(chi2, 4), "df": n - 1, "p_value": round(p, 6),
            "consistent": w >= threshold and p < ALPHA, "rank_sums": {o: round(v, 2) for o, v in rank_sums.items()},
            "means": means, "note": None}


# ── Сравнение нескольких СИИ в единых шкалах (п. 7.2.2.5) ──

def _scale(row: dict) -> tuple:
    def r(v):
        return None if v is None else round(float(v), 4)
    return (row.get("metric_kind"), r(row.get("baseline")), r(row.get("tol_low")), r(row.get("tol_high")))


def compare_on_common_scales(assessments: list[dict]) -> dict:
    """assessments: [{period_id, system, period, rows: [{characteristic, subcharacteristic,
    metric_kind, baseline, tol_low, tol_high, normalized_x}]}].

    Сравнимы только субхарактеристики, измеренные во ВСЕХ оценках одной и той же метрикой с
    одним и тем же эталоном и допусками — иначе X нормирован к разным шкалам и сравнение
    «кто лучше» некорректно. Интегральный показатель для рейтинга считается по этому общему
    набору (равные веса), а не по полному Q каждой оценки."""
    if len(assessments) < 2:
        return {"common": [], "excluded": [], "ranking": [], "note": "для сравнения нужно не меньше двух оценок"}
    keyed = [{(r["characteristic"], r["subcharacteristic"]): r for r in a["rows"] if r.get("normalized_x") is not None}
             for a in assessments]
    all_pairs = sorted(set().union(*(set(k) for k in keyed)))
    common, excluded = [], []
    for pair in all_pairs:
        present = [k.get(pair) for k in keyed]
        if any(p is None for p in present):
            excluded.append({"characteristic": pair[0], "subcharacteristic": pair[1], "reason": "измерена не во всех оценках"})
            continue
        if len({_scale(p) for p in present}) > 1:
            excluded.append({"characteristic": pair[0], "subcharacteristic": pair[1],
                             "reason": "разные метрики или эталон/допуски — шкалы не совпадают"})
            continue
        common.append({"characteristic": pair[0], "subcharacteristic": pair[1],
                       "values": [round(float(p["normalized_x"]), 4) for p in present]})
    ranking = []
    for i, a in enumerate(assessments):
        agg = aggregate([{"characteristic": c["characteristic"], "subcharacteristic": c["subcharacteristic"],
                          "normalized_x": c["values"][i]} for c in common])
        ranking.append({"period_id": a["period_id"], "system": a["system"], "period": a["period"],
                        "q_common": agg["q"], "level": agg["level"], "q_full": a.get("q_full")})
    ranking.sort(key=lambda r: (r["q_common"] is None, -(r["q_common"] or 0)))
    return {"common": common, "excluded": excluded, "ranking": ranking,
            "note": f"Сравнение по {len(common)} субхарактеристикам в единых шкалах; исключено: {len(excluded)}"}
