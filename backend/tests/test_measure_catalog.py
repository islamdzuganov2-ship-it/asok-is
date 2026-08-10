"""Тесты каталога «риск → подхарактеристика → мера» (BL-007, задача 7 / RE-06, §4.2).

Каталог — методологическая референс-база в коде (как QUALITY_MODEL). Тесты держат её целостность:
имена подхарактеристик валидны, покрыты ВСЕ 31, у каждой связки есть обе меры (устраняющая и
компенсирующая) — иначе теряется ключевое различие §4.2.
"""
from app.modules.econ.measure_catalog import CATALOG, catalog_for
from app.modules.quality.quality_model import QUALITY_MODEL, QUALITY_PAIRS


def test_catalog_names_match_quality_model():
    """Никаких «висячих» названий: пара (характеристика, подхарактеристика) есть в модели качества."""
    valid = {(c, s) for c, s, _f in QUALITY_PAIRS}
    unknown = [(e.characteristic, e.subcharacteristic) for e in CATALOG
               if (e.characteristic, e.subcharacteristic) not in valid]
    assert not unknown, f"нет в QUALITY_MODEL: {unknown}"


def test_catalog_covers_every_subcharacteristic():
    """Все 31 подхарактеристика ГОСТ 25010 имеют хотя бы одну типовую связку."""
    covered = {(e.characteristic, e.subcharacteristic) for e in CATALOG}
    missing = [(c, s) for c, s, _f in QUALITY_PAIRS if (c, s) not in covered]
    assert not missing, f"не покрыты: {missing}"
    assert len(covered) == 31


def test_every_entry_has_both_measure_kinds():
    """§4.2: у каждой связки есть и устраняющая, и компенсирующая мера — различие зашито в модель."""
    broken = [e.subcharacteristic for e in CATALOG
              if not e.eliminating.strip() or not e.compensating.strip() or not e.risk.strip()]
    assert not broken, f"пустые поля у: {broken}"


def test_catalog_size_matches_spec_range():
    """§4.2 ориентир — 60-80 связок; допускаем 40+, но не «пара примеров»."""
    assert len(CATALOG) >= 40


def test_filter_by_characteristic_and_subcharacteristic():
    rel = catalog_for(characteristic="Надёжность")
    assert rel and all(e.characteristic == "Надёжность" for e in rel)
    one = catalog_for(subcharacteristic="Отказоустойчивость")
    assert one and all(e.subcharacteristic == "Отказоустойчивость" for e in one)
    assert any("Кластеризация" in e.eliminating for e in one)
    assert catalog_for(characteristic="Такой характеристики нет") == []


def test_all_characteristics_present():
    chars = {e.characteristic for e in CATALOG}
    assert chars == {c for c, _subs in QUALITY_MODEL}
