"""Тесты демо-набора банковского масштаба (app.scripts.bank_demo).

Проверяется не «данные есть», а СВЯЗНОСТЬ: именно она ломается незаметно. Набор держится на
цепочке «минуты простоя → C_ТС → ALE → ΔALE меры → ROSI», и если разорвать любое звено —
например, назначить мере эффект больше стоимости риска, — дашборд покажет цифру, которую
система не сможет объяснить, а тесты промолчат.

Здесь только чистые данные и функции: подключение к БД не требуется.
"""
import pytest

from app.scripts.bank_demo import operations as ops
from app.scripts.bank_demo import scale
from app.scripts.bank_demo.landscape import BUSINESS_PROCESSES, OWNERS, SYSTEMS
from app.scripts.bank_demo.quality_profiles import (
    QUARTERS,
    SCENARIOS,
    UNMEASURABLE,
    target_x,
)

SYSTEM_CODES = {code for code, *_ in SYSTEMS}


# ── Калибровка масштаба ───────────────────────────────────────────────────────────────────────

def test_bank_cost_per_min_derived_from_income():
    """Стоимость минуты банка выводится из дохода, а не назначается «красивым» числом."""
    expected = round(scale.BANK_OPERATING_INCOME_RUB / (365 * 24 * 60))
    assert scale.BANK_COST_PER_MIN == expected
    # Порядок величины для топ-3: миллионы рублей в минуту, не тысячи и не миллиарды.
    assert 1_000_000 < scale.BANK_COST_PER_MIN < 20_000_000


def test_frontal_processes_cost_more_than_backoffice():
    """Разрыв между фронтом и бэк-офисом — то, ради чего контур считает деньги."""
    assert ops.RECURRENCE  # набор повторов не пуст
    frontal = scale.BP_COST_PER_MIN["BP-PAY"]
    backoffice = scale.BP_COST_PER_MIN["BP-HR"]
    assert frontal > backoffice * 50


def test_no_business_process_exceeds_whole_bank():
    """Ни один процесс не может стоить дороже минуты работы банка целиком."""
    for code, value in scale.BP_COST_PER_MIN.items():
        assert value <= scale.BANK_COST_PER_MIN, f"{code} дороже всего банка"


# ── Ландшафт ──────────────────────────────────────────────────────────────────────────────────

def test_system_codes_unique():
    assert len(SYSTEM_CODES) == len(SYSTEMS)


def test_every_system_has_known_owner():
    """Владелец ИС — адресат мер и эскалаций; неизвестное ФИО обрывает эту цепочку."""
    for code, _name, _crit, owner, *_ in SYSTEMS:
        assert owner in OWNERS, f"{code}: владелец «{owner}» не описан в OWNERS"


def test_business_process_carriers_exist_and_shares_sane():
    for code, _name, _kind, carriers in BUSINESS_PROCESSES:
        assert carriers, f"{code}: процесс без систем-носителей"
        total = 0.0
        for sys_code, share in carriers:
            assert sys_code in SYSTEM_CODES, f"{code}: неизвестная ИС {sys_code}"
            assert 0 < share <= 1
            total += share
        assert total == pytest.approx(1.0), f"{code}: доли носителей дают {total}, а не 1.0"


def test_every_business_process_has_cost():
    for code, *_ in BUSINESS_PROCESSES:
        assert code in scale.BP_COST_PER_MIN, f"{code}: не задана стоимость минуты простоя"


# ── Сценарии качества ─────────────────────────────────────────────────────────────────────────

def test_target_x_deterministic():
    """Повторный сев обязан давать ту же картину — иначе показ «переезжает» между сессиями."""
    a = target_x("CREDIT_CONV", "Сопровождаемость", "Модифицируемость", 3)
    b = target_x("CREDIT_CONV", "Сопровождаемость", "Модифицируемость", 3)
    assert a == b
    assert 0.02 <= a <= 0.99


def test_credit_conveyor_degrades_over_two_years():
    """Сюжет менеджера по качеству: деградация видна только на длинном тренде."""
    first = target_x("CREDIT_CONV", "Сопровождаемость", "Модифицируемость", 0)
    last = target_x("CREDIT_CONV", "Сопровождаемость", "Модифицируемость", len(QUARTERS) - 1)
    assert last < first - 0.1


def test_payment_hub_incident_visible_on_dashboard():
    """Сюжет ЛПР: инцидент СБП в Q2-2026 должен быть заметной просадкой, а не шумом."""
    q = QUARTERS.index("Q2-2026")
    dip = target_x("PAY_HUB", "Надёжность", "Отказоустойчивость", q)
    before = target_x("PAY_HUB", "Надёжность", "Отказоустойчивость", q - 1)
    assert before - dip >= 0.2


def test_security_program_improves_idm():
    """Сюжет владельца риска: программа ИБ даёт подтверждённый рост защищённости."""
    first = target_x("IDM", "Защищённость", "Конфиденциальность", 0)
    last = target_x("IDM", "Защищённость", "Конфиденциальность", len(QUARTERS) - 1)
    assert last > first + 0.1


def test_scenarios_cover_all_systems():
    for code in SYSTEM_CODES:
        assert code in SCENARIOS, f"{code}: нет сценария качества"


def test_unmeasurable_pairs_reference_known_systems():
    for code, _sub in UNMEASURABLE:
        assert code in SYSTEM_CODES


# ── Связность эксплуатации ────────────────────────────────────────────────────────────────────

def test_incidents_reference_known_systems():
    for item in ops.INCIDENTS:
        assert item["system"] in SYSTEM_CODES, f"{item['title']}: неизвестная ИС"


def test_incident_physical_inputs_sane():
    """Деньги считает движок из физики: минуты, доля влияния и часы обязаны быть осмысленными."""
    for item in ops.INCIDENTS:
        assert item["downtime"] > 0
        assert 0 < item["k"] <= 1.0
        assert item["l1"] >= 0 and item["l2"] >= 0 and item["l3"] >= 0
        # Разбор сбоя без первопричины и мер по неповторению — это не разбор.
        assert item["root"] and item["admission"] and item["prevent"]


def test_recurrence_titles_exist():
    titles = {item["title"] for item in ops.INCIDENTS}
    for title in ops.RECURRENCE:
        assert title in titles, f"повтор задан для несуществующего сбоя: {title}"


def test_risk_events_reference_known_incidents_and_systems():
    titles = {item["title"] for item in ops.INCIDENTS}
    codes = {item["code"] for item in ops.RISK_BASE}
    for ev in ops.RISK_EVENTS:
        assert ev["system"] in SYSTEM_CODES
        assert ev["risk_base"] in codes, f"{ev['code']}: нет такого риска в базе"
        for title in ev["incidents"]:
            assert title in titles, f"{ev['code']}: нет такого сбоя — {title}"


def test_event_without_incidents_has_expert_estimate():
    """Событие без реализаций обязано иметь экспертную оценку — иначе его ALE молча нулевой."""
    for ev in ops.RISK_EVENTS:
        if not ev["incidents"]:
            assert ev.get("aro") is not None, f"{ev['code']}: нет ни реализаций, ни экспертного ARO"


def test_measures_reference_known_systems():
    for m in ops.MEASURES:
        assert m["system"] in SYSTEM_CODES, f"{m['title']}: неизвестная ИС"


def test_measure_removal_share_is_a_share():
    """Мера не может снять больше, чем риск стоит: доля снятия строго в (0, 1]."""
    for m in ops.MEASURES:
        share = m.get("removal_share")
        if share is not None:
            assert 0 < share <= 1.0, f"{m['title']}: доля снятия {share} вне диапазона"


def test_measures_have_economics_and_deadline():
    for m in ops.MEASURES:
        assert m["capex"] > 0 and m["opex"] >= 0
        assert m["months"] > 0
        assert len(m["due"].split(".")) == 3, f"{m['title']}: срок не в формате ДД.ММ.ГГГГ"
        assert m["type"] in ("ELIMINATING", "COMPENSATING")
        assert m["status"] in ("APPROVED", "PENDING_APPROVAL", "REJECTED")


def test_nonconformity_stages_cover_the_funnel():
    """Воронка замкнутости должна быть неоднородной — ровная ничего не объясняет на показе."""
    stages = {nc["stage"] for nc in ops.NONCONFORMITIES}
    assert {"IDENTIFIED", "EVALUATED", "DECIDED", "IN_PROGRESS", "VERIFIED", "ACCEPTED"} <= stages


def test_nonconformities_with_measure_reference_existing_measure():
    titles = {m["title"] for m in ops.MEASURES}
    for nc in ops.NONCONFORMITIES:
        if nc.get("measure_title"):
            assert nc["measure_title"] in titles, f"{nc['system']}: нет такой меры"


def test_verified_nonconformity_separates_duties():
    """SoD: исполнял и верифицировал несоответствие — разные лица."""
    for nc in ops.NONCONFORMITIES:
        if nc["stage"] == "VERIFIED":
            assert nc["executed_by"] != nc["verified_by"]
