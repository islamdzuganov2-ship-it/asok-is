"""Тест-страж весов ГОСТ 25010 (ТЗ v19 УК-04). Источник — `веса характеристик_2.xlsx`,
разбор — `docs/ТЗ_19_Управленческий_Контур_и_Веса.md` §1.0.

Четыре инварианта, которые обязаны сходиться ВСЕГДА — если тест здесь падает, значит либо
файл весов, либо QUALITY_MODEL, либо weights.py разошлись, и считать интегральный балл
дальше нельзя (не «немного неточно» — неверно).
"""
from app.modules.quality.quality_model import QUALITY_MODEL, QUALITY_PAIR_KEYS, TOTAL_SUBS
from app.modules.quality.weights import (
    CHARACTERISTIC_WEIGHTS,
    ISO_KEY_BY_PAIR,
    SUBCHAR_WEIGHTS,
    TOTAL_WEIGHT,
    subchar_weight,
)

# Независимая транскрипция весов характеристик из файла — НЕ производная от SUBCHAR_WEIGHTS,
# чтобы тест ловил опечатку в самих исходных данных, а не только рассогласование источников.
EXPECTED_CHARACTERISTIC_WEIGHTS = {
    "Функциональная пригодность": 10,
    "Производительность": 20,
    "Совместимость": 10,
    "Удобство использования": 5,
    "Надёжность": 20,
    "Защищённость": 20,
    "Сопровождаемость": 10,
    "Переносимость": 5,
}


def test_total_weight_is_100():
    assert TOTAL_WEIGHT == 100


def test_characteristic_weights_sum_to_100():
    assert sum(CHARACTERISTIC_WEIGHTS.values()) == 100


def test_characteristic_weights_match_independent_transcription():
    assert CHARACTERISTIC_WEIGHTS == EXPECTED_CHARACTERISTIC_WEIGHTS


def test_each_characteristic_subweights_sum_to_characteristic_weight():
    """Σ весов подхарактеристик внутри характеристики = вес самой характеристики — 8 из 8,
    без округлений (проверено вручную на исходном файле, см. ТЗ §1.0)."""
    for characteristic, weight in EXPECTED_CHARACTERISTIC_WEIGHTS.items():
        subs_sum = sum(
            w for (c, _s), w in SUBCHAR_WEIGHTS.items() if c == characteristic
        )
        assert subs_sum == weight, f"{characteristic}: Σ подхар. {subs_sum} ≠ вес хар. {weight}"


def test_coverage_matches_quality_model_exactly():
    """31 пара в SUBCHAR_WEIGHTS ↔ 31 пара в QUALITY_MODEL — без сирот с обеих сторон."""
    assert TOTAL_SUBS == 31
    assert set(SUBCHAR_WEIGHTS.keys()) == QUALITY_PAIR_KEYS
    assert len(SUBCHAR_WEIGHTS) == 31


def test_iso_key_coverage_matches_subchar_weights():
    assert set(ISO_KEY_BY_PAIR.keys()) == set(SUBCHAR_WEIGHTS.keys())
    assert len(set(ISO_KEY_BY_PAIR.values())) == 31  # английские термины не дублируются


def test_accessibility_ambiguity_trap_has_distinct_weights():
    """Главная ловушка сшивки: «Доступность» дважды в коде, с разным весом (×10). Явный тест
    на оба значения — если кто-то схлопнет ключи по русскому имени, тест немедленно упадёт."""
    accessibility = subchar_weight("Удобство использования", "Доступность (accessibility)")
    availability = subchar_weight("Надёжность", "Доступность (uptime)")
    assert accessibility == 0.5
    assert availability == 5
    assert availability == accessibility * 10


def test_subchar_weight_raises_on_unknown_pair():
    import pytest
    with pytest.raises(KeyError):
        subchar_weight("Функциональная пригодность", "Несуществующая подхарактеристика")


def test_weights_cover_every_subcharacteristic_in_quality_model_object():
    """Сверка напрямую по объекту QUALITY_MODEL (не только по QUALITY_PAIR_KEYS) — на случай,
    если кто-то поправит вспомогательный набор ключей, но забудет сам список."""
    for characteristic, subs in QUALITY_MODEL:
        for sub, _formula in subs:
            assert (characteristic, sub) in SUBCHAR_WEIGHTS, (
                f"нет веса для ({characteristic!r}, {sub!r})"
            )
