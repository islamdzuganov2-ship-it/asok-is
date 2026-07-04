"""Юнит-тесты нормализации характеристик к канонической модели 25010 (DEF-02).

Гарантируют, что замусоренные/легаси имена из Excel-импорта приводятся к 8 каноническим
характеристикам — иначе дашборды/теплокарты двоятся (как было до правки).
"""
from app.modules.quality import ABBR, CHARACTERISTICS, canonical_characteristic


def test_canonical_exact_and_case():
    assert canonical_characteristic("Надёжность") == "Надёжность"
    assert canonical_characteristic("надежность") == "Надёжность"   # ё→е, нижний регистр
    assert canonical_characteristic(" Защищённость ") == "Защищённость"


def test_canonical_aliases():
    assert canonical_characteristic("Безопасность") == "Защищённость"
    assert canonical_characteristic("Пригодность для обслуживания") == "Сопровождаемость"
    assert canonical_characteristic("Тестируемость") == "Сопровождаемость"


def test_canonical_prefix_tails():
    # «Хвосты» из Excel-выгрузки сопоставляются по префиксу.
    assert canonical_characteristic("Эффективность. Показатели временных Характеристик") == "Производительность"
    assert canonical_characteristic("Удобство использования. Показатели полноты описания") == "Удобство использования"


def test_canonical_unknown_returns_none():
    assert canonical_characteristic("Абракадабра") is None
    assert canonical_characteristic("") is None
    assert canonical_characteristic(None) is None


def test_all_eight_characteristics_have_abbr():
    assert len(CHARACTERISTICS) == 8
    for c in CHARACTERISTICS:
        assert c in ABBR and ABBR[c]
