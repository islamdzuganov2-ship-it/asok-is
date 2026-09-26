"""
Глубина оценки ИС по классу критичности (BL-007 RE-19, рычаг 2; §6.2 ТЗ контура).

Диагноз роли аналитика — перегруз объёмом: каждая ИС оценивалась по всем 31 подхарактеристике,
вспомогательная вики — с той же глубиной, что АБС. Рычаг — дифференцировать глубину:

  • FULL      — Mission Critical: все 31 подхарактеристика;
  • PROFILE   — Business Critical: «профильные» (вес ГОСТ ≥ 3 из §1.0) + скрининг;
  • SCREENING — Support / Business Operational: по одной, самой весомой, на характеристику (8).

Набор выводится из весов ГОСТ (weights.SUBCHAR_WEIGHTS), а не перечисляется руками: правка весов
в файле заказчика автоматически меняет и профиль, и скрининг. Порядок — как в QUALITY_MODEL.
"""
from __future__ import annotations

from app.modules.quality.quality_model import QUALITY_MODEL
from app.modules.quality.weights import SUBCHAR_WEIGHTS

DEPTH_FULL = "FULL"
DEPTH_PROFILE = "PROFILE"
DEPTH_SCREENING = "SCREENING"
DEPTHS = (DEPTH_FULL, DEPTH_PROFILE, DEPTH_SCREENING)

DEPTH_LABELS = {
    DEPTH_FULL: "полная оценка",
    DEPTH_PROFILE: "профильная оценка + скрининг",
    DEPTH_SCREENING: "скрининг",
}

# Порог «профильной» подхарактеристики — вес ГОСТ (Σ=100 по модели).
PROFILE_WEIGHT_THRESHOLD = 3.0

_BY_CLASS = {
    "MISSION CRITICAL": DEPTH_FULL,
    "BUSINESS CRITICAL": DEPTH_PROFILE,
    "BUSINESS OPERATIONAL": DEPTH_SCREENING,
}


def depth_for_criticality(criticality_class: str | None) -> str:
    """Глубина по классу ИС; неизвестный класс — полная (консервативно: лучше лишняя проверка)."""
    return _BY_CLASS.get((criticality_class or "").upper(), DEPTH_FULL)


def _model_order() -> list[tuple[str, str]]:
    return [(c, s) for c, subs in QUALITY_MODEL for s, _f in subs]


def screening_pairs() -> list[tuple[str, str]]:
    """По одной подхарактеристике на характеристику — с наибольшим весом (при равенстве — первая)."""
    best: dict[str, tuple[str, str]] = {}
    for c, s in _model_order():
        cur = best.get(c)
        if cur is None or SUBCHAR_WEIGHTS[(c, s)] > SUBCHAR_WEIGHTS[cur]:
            best[c] = (c, s)
    chosen = set(best.values())
    return [p for p in _model_order() if p in chosen]


def required_pairs(depth: str | None) -> list[tuple[str, str]]:
    """Обязательный набор подхарактеристик для глубины (NULL — периоды до RE-19 → полная)."""
    order = _model_order()
    if depth == DEPTH_SCREENING:
        return screening_pairs()
    if depth == DEPTH_PROFILE:
        chosen = set(screening_pairs()) | {p for p in order if SUBCHAR_WEIGHTS[p] >= PROFILE_WEIGHT_THRESHOLD}
        return [p for p in order if p in chosen]
    return order


def required_set(depth: str | None) -> set[tuple[str, str]]:
    return set(required_pairs(depth))
