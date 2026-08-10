"""Юнит-тесты матриц принятия решений (BL-009, ТЗ v18 п.7).

Критерии приёмки:
  1) матрицы ПОЛНЫЕ — заполнена каждая ячейка, «дырок» нет;
  2) решения монотонны: рост серьёзности и критичности не смягчает решение;
  3) вывод с низким доверием нельзя вынести на правление;
  4) неизвестные значения не поднимают уровень решения (отсутствие данных ≠ тревога);
  5) перечень пробелов данных воспроизводим и питает уточняющие вопросы.
"""
import pytest

from app.modules.llm import decisions
from app.modules.llm.decisions import (
    CRITICALITIES,
    SEVERITIES,
    TIER_BOARD,
    TIER_MONITOR,
    TIER_OWNER,
    data_sufficiency,
    triage,
    trust,
)

_TIER_RANK = {TIER_MONITOR: 0, TIER_OWNER: 1, TIER_BOARD: 2}


# ─── Критерий 1: полнота матриц ──────────────────────────────────────────────────────

def test_triage_matrix_is_complete():
    for sev in SEVERITIES:
        for crit in CRITICALITIES:
            assert (sev, crit) in decisions.TRIAGE_MATRIX, f"нет ячейки ({sev}, {crit})"
    assert len(decisions.TRIAGE_MATRIX) == len(SEVERITIES) * len(CRITICALITIES)


def test_trust_matrix_is_complete():
    for conf in decisions.CONFIDENCES:
        for bucket in decisions._FALLBACK_BUCKETS:
            assert (conf, bucket) in decisions.TRUST_MATRIX, f"нет ячейки ({conf}, {bucket})"


# ─── Критерий 2: монотонность решений ────────────────────────────────────────────────

@pytest.mark.parametrize("crit", CRITICALITIES)
def test_higher_severity_never_relaxes_decision(crit: str):
    ranks = [_TIER_RANK[triage(sev, crit).tier] for sev in SEVERITIES]
    assert ranks == sorted(ranks), f"рост серьёзности смягчил решение при критичности {crit}"


@pytest.mark.parametrize("sev", SEVERITIES)
def test_higher_criticality_never_relaxes_decision(sev: str):
    ranks = [_TIER_RANK[triage(sev, crit).tier] for crit in CRITICALITIES]
    assert ranks == sorted(ranks), f"рост критичности смягчил решение при серьёзности {sev}"


@pytest.mark.parametrize("sev", SEVERITIES)
def test_higher_criticality_never_extends_deadline(sev: str):
    days = [triage(sev, crit).sla_days for crit in CRITICALITIES]
    assert days == sorted(days, reverse=True), "более критичной ИС дан более длинный срок"


def test_worst_cell_goes_to_board_fastest():
    worst = triage("high", "MISSION CRITICAL")
    assert worst.tier == TIER_BOARD
    assert worst.sla_days == min(c.sla_days for c in decisions.TRIAGE_MATRIX.values())


# ─── Критерий 3: доверие к выводу ────────────────────────────────────────────────────

def test_low_confidence_never_reaches_the_board():
    for bucket_fell_back, total in ((0, 9), (4, 9), (8, 9)):
        d = trust("низкая", bucket_fell_back, total)
        assert d.may_go_to_board is False
        assert d.level == "низкий"


def test_full_llm_run_with_all_sources_is_trusted():
    d = trust("высокая", 0, 9)
    assert d.level == "высокий" and d.may_go_to_board is True


def test_mostly_deterministic_run_is_not_an_analytical_conclusion():
    # Все этапы на детерминированном откате: это сводка фактов, а не аналитический вывод.
    d = trust("высокая", 9, 9)
    assert d.may_go_to_board is False


def test_trust_handles_empty_pipeline_without_crash():
    d = trust("средняя", 0, 0)
    assert d.level in ("низкий", "ограниченный")


# ─── Критерий 4: неизвестные значения не повышают уровень решения ────────────────────

def test_unknown_criticality_maps_to_softest_class():
    assert decisions.normalize_criticality("") == "BUSINESS OPERATIONAL"
    assert decisions.normalize_criticality("что-то своё") == "BUSINESS OPERATIONAL"
    # Подчёркнутая форма из ORM-энума тоже распознаётся.
    assert decisions.normalize_criticality("MISSION_CRITICAL") == "MISSION CRITICAL"


def test_unknown_severity_is_treated_as_no_signal():
    assert triage("абракадабра", "BUSINESS CRITICAL").tier == triage("none", "BUSINESS CRITICAL").tier


def test_unknown_confidence_is_treated_as_lowest():
    assert trust("абракадабра", 0, 9).level == trust("низкая", 0, 9).level


# ─── Критерий 5: пробелы данных ──────────────────────────────────────────────────────

def test_full_input_has_no_gaps():
    d = data_sufficiency(31, 31, has_judgments=True, has_risks=True, has_measures=True,
                         has_history=True, has_criticality=True)
    assert d.level == "достаточно" and d.gaps == []


def test_missing_primary_sources_is_insufficient():
    d = data_sufficiency(0, 0)
    assert d.level == "недостаточно"
    assert any("суждения" in g for g in d.gaps)


def test_low_coverage_is_reported_as_gap():
    d = data_sufficiency(10, 31, has_judgments=True, has_risks=True, has_measures=True,
                         has_history=True, has_criticality=True)
    assert d.level == "частично"
    assert any("измерения подхарактеристик" in g for g in d.gaps)


def test_coverage_threshold_matches_rule_engine():
    # Один порог на систему: расхождение движка правил и матрицы дало бы два разных
    # сигнала об одном и том же покрытии.
    from app.modules.llm.gate import COVERAGE_THRESHOLD
    assert decisions.COVERAGE_OK == COVERAGE_THRESHOLD


def test_matrices_export_is_serialisable():
    m = decisions.matrices()
    assert {"triage", "trust", "data_sufficiency"} <= set(m)
    assert len(m["triage"]["cells"]) == len(SEVERITIES) * len(CRITICALITIES)


def test_as_block_mentions_addressee_and_deadline():
    block = decisions.as_block(
        triage("high", "MISSION CRITICAL"),
        trust("высокая", 0, 9),
        data_sufficiency(31, 31, has_judgments=True, has_risks=True, has_measures=True,
                         has_history=True, has_criticality=True),
    )
    assert "Уровень решения" in block and "адресат" in block and "срок" in block
