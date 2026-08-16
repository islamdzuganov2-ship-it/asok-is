"""Юнит-тесты двухуровневой свёртки балла (ТЗ v19 УК-06/07, Р-6) — app/modules/quality/scoring.py.

Чистые функции, без БД. Покрывают инварианты: перенормировка при неполном покрытии (В-5),
разведение весов подхарактеристик и критичности по уровням, устойчивость к пустому входу.
"""
from app.modules.quality.scoring import (
    SubcharScore,
    portfolio_score,
    weighted_system_score,
)


def test_full_coverage_weighted_average():
    # Функц. пригодность: полнота=5, корректность=3, целесообразность=2 (Σ=10)
    scores = [
        SubcharScore("Функц.", "Полнота", 5, 80),
        SubcharScore("Функц.", "Корректность", 3, 60),
        SubcharScore("Функц.", "Целесообразность", 2, 100),
    ]
    result = weighted_system_score(scores)
    # (5*80 + 3*60 + 2*100) / 10 = (400+180+200)/10 = 78
    assert result.score == 78
    assert result.weight_applied == 10
    assert result.weight_total == 10
    assert result.coverage == 1.0


def test_partial_coverage_renormalizes_not_zero_fills():
    """В-5: unmeasurable выпадает из ОБЕИХ сумм — не считается нулём, не тянет балл вниз."""
    scores = [
        SubcharScore("Ф", "A", 5, 80),
        SubcharScore("Ф", "B", 3, None),   # невозможно измерить
        SubcharScore("Ф", "C", 2, 100),
    ]
    result = weighted_system_score(scores)
    # Только A и C: (5*80 + 2*100) / (5+2) = (400+200)/7 = 85.714...
    assert round(result.score, 2) == 85.71
    assert result.weight_applied == 7
    assert result.weight_total == 10
    assert round(result.coverage, 4) == 0.7


def test_no_measured_subchars_returns_none_not_zero():
    scores = [SubcharScore("Ф", "A", 5, None), SubcharScore("Ф", "B", 3, None)]
    result = weighted_system_score(scores)
    assert result.score is None
    assert result.coverage == 0.0


def test_empty_input_returns_none():
    result = weighted_system_score([])
    assert result.score is None
    assert result.weight_total == 0


def test_contributions_sorted_by_weight_descending():
    scores = [
        SubcharScore("Ф", "Малый вес", 1, 50),
        SubcharScore("Ф", "Большой вес", 7, 90),
        SubcharScore("Ф", "Средний вес", 3, 70),
    ]
    result = weighted_system_score(scores)
    weights = [c["weight"] for c in result.contributions]
    assert weights == sorted(weights, reverse=True)
    assert result.contributions[0]["subcharacteristic"] == "Большой вес"


def test_points_contribution_sums_to_final_score():
    """Вклады объясняют цифру ПОЛНОСТЬЮ (пункт 1, «не показываем число без ответа на
    почему») — сумма вкладов близка к баллу с точностью округления (каждый вклад и сам балл
    независимо округлены до 4 знаков — накопленная погрешность на 3 слагаемых ограничена
    ~n*0.00005, поэтому допуск 1e-3, а не машинный эпсилон)."""
    scores = [SubcharScore("Ф", "A", 5, 80), SubcharScore("Ф", "B", 3, 60), SubcharScore("Ф", "C", 2, 100)]
    result = weighted_system_score(scores)
    assert abs(sum(c["pointsContribution"] for c in result.contributions) - result.score) < 1e-3


# ── Портфельная свёртка (критичность) ──

def test_portfolio_score_weights_by_criticality():
    system_scores = {"sys-a": 90, "sys-b": 50}
    criticality = {"sys-a": "MISSION_CRITICAL", "sys-b": "SUPPORT"}
    weights = {"MISSION_CRITICAL": 3, "BUSINESS_CRITICAL": 2, "SUPPORT": 1}
    result = portfolio_score(system_scores, criticality, weights)
    # (3*90 + 1*50) / (3+1) = (270+50)/4 = 80
    assert result.score == 80


def test_portfolio_score_flat_average_when_criticality_weights_equal():
    """Единичные веса → эквивалент плоского среднего (регрессионная защита старого поведения)."""
    system_scores = {"a": 60, "b": 80, "c": 100}
    criticality = {"a": "X", "b": "X", "c": "X"}
    weights = {"X": 1}
    result = portfolio_score(system_scores, criticality, weights)
    assert result.score == 80  # (60+80+100)/3


def test_portfolio_score_unknown_criticality_uses_default_weight():
    system_scores = {"a": 90, "b": 10}
    criticality = {"a": "MISSION_CRITICAL", "b": "НЕИЗВЕСТНЫЙ_КЛАСС"}
    weights = {"MISSION_CRITICAL": 3}
    result = portfolio_score(system_scores, criticality, weights, default_weight=1.0)
    # (3*90 + 1*10) / 4 = 280/4 = 70
    assert result.score == 70


def test_portfolio_score_ignores_unscored_systems():
    system_scores = {"a": 90, "b": None}
    criticality = {"a": "MISSION_CRITICAL", "b": "SUPPORT"}
    weights = {"MISSION_CRITICAL": 3, "SUPPORT": 1}
    result = portfolio_score(system_scores, criticality, weights)
    assert result.score == 90  # «b» без данных не участвует и не тянет вниз


def test_portfolio_score_empty_returns_none():
    result = portfolio_score({}, {}, {})
    assert result.score is None


def test_portfolio_points_contribution_sums_to_final_score():
    system_scores = {"a": 90, "b": 50, "c": 70}
    criticality = {"a": "MISSION_CRITICAL", "b": "SUPPORT", "c": "BUSINESS_CRITICAL"}
    weights = {"MISSION_CRITICAL": 3, "BUSINESS_CRITICAL": 2, "SUPPORT": 1}
    result = portfolio_score(system_scores, criticality, weights)
    total = sum(c["pointsContribution"] for c in result.system_contributions)
    assert abs(total - result.score) < 1e-3  # см. комментарий в test_points_contribution_sums_to_final_score
