"""Тесты хронологии периодов (app.shared.periods) — DEF-13.

Регресс на две ловушки выбора «последнего периода»:
  • лексикографика: «Q4-2025» > «Q2-2026» как строки;
  • created_at: сиды пишут все периоды одной транзакцией (метки совпадают).
"""
from app.shared.periods import period_sort_key


def test_chronological_order_across_years():
    quarters = ["Q1-2025", "Q2-2025", "Q3-2025", "Q4-2025", "Q1-2026", "Q2-2026"]
    assert sorted(quarters, key=period_sort_key) == quarters


def test_q2_2026_is_later_than_q4_2025():
    # Лексикографически "Q4-2025" > "Q2-2026" — семантически наоборот.
    assert period_sort_key("Q2-2026") > period_sort_key("Q4-2025")


def test_latest_selection():
    quarters = ["Q4-2025", "Q2-2026", "Q1-2025", "Q3-2025"]
    assert max(quarters, key=period_sort_key) == "Q2-2026"


def test_unparsable_goes_last():
    assert period_sort_key("итоговый") == (0, 0)
    assert period_sort_key(None) == (0, 0)
    assert period_sort_key("2026") == (0, 0)
    # Любой валидный квартал новее нераспознанного.
    assert period_sort_key("Q1-2000") > period_sort_key("н/д")


def test_format_variants():
    assert period_sort_key("Q1 2026") == (2026, 1)
    assert period_sort_key("Q1-2026") == (2026, 1)
