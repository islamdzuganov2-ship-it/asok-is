"""Тесты каталога мер (BL-007, задача 7, §4.2).

Ключевой инвариант: каталог покрывает ВСЕ подхарактеристики модели качества — иначе при разборе
несоответствия аналитик упрётся в подхарактеристику без типовых мер. Плюс различие устраняющая vs
компенсирующая жёстко присутствует в каждой связке.
"""
from app.modules.econ.measure_catalog import (
    MEASURE_CATALOG,
    as_out,
    covered_subchars,
    entries_for,
    uncovered_subchars,
)
from app.modules.quality.quality_model import QUALITY_MODEL

QUALITY_SUBCHARS = {(c, s) for c, subs in QUALITY_MODEL for s, _f in subs}


def test_catalog_covers_all_31_subcharacteristics():
    assert uncovered_subchars() == set(), f"нет типовых мер для: {sorted(uncovered_subchars())}"
    assert len(QUALITY_SUBCHARS) == 31
    assert covered_subchars() == QUALITY_SUBCHARS


def test_every_entry_has_both_measure_types_and_risk():
    for e in MEASURE_CATALOG:
        assert e.risk.strip(), f"пустой риск: {e.subcharacteristic}"
        assert e.eliminating.strip() and e.compensating.strip(), (
            f"обе меры обязательны: {e.subcharacteristic}"
        )
        # устраняющая ≠ компенсирующая — иначе различие §4.2 не имеет смысла.
        assert e.eliminating != e.compensating


def test_entries_are_bound_to_model_pairs():
    # Каждая связка ссылается на существующую пару (характеристика, подхарактеристика) модели.
    for e in MEASURE_CATALOG:
        assert (e.characteristic, e.subcharacteristic) in QUALITY_SUBCHARS


def test_filter_by_characteristic_and_subcharacteristic():
    rel = entries_for(characteristic="Надёжность")
    assert rel and all(e.characteristic == "Надёжность" for e in rel)
    otk = entries_for(subcharacteristic="Отказоустойчивость")
    assert otk and all(e.subcharacteristic == "Отказоустойчивость" for e in otk)


def test_as_out_maps_to_camel_schema():
    out = as_out(entries_for(characteristic="Защищённость"))
    assert out
    dumped = out[0].model_dump(by_alias=True)
    assert set(dumped) == {"characteristic", "subcharacteristic", "risk", "eliminating", "compensating"}


def test_catalog_has_at_least_full_coverage_plus_critical_extras():
    # 31 подхарактеристика + дополнительные риски по критичным зонам.
    assert len(MEASURE_CATALOG) >= 31
