"""Юнит-тесты разбора русской даты (ТЗ v19 УК-36) — app/scripts/backfill_due_dates.py."""
from datetime import datetime, timezone

from app.scripts.backfill_due_dates import parse_ru_date


def test_parses_valid_ru_date():
    assert parse_ru_date("30.09.2026") == datetime(2026, 9, 30, tzinfo=timezone.utc)


def test_parses_leap_day():
    assert parse_ru_date("29.02.2028") == datetime(2028, 2, 29, tzinfo=timezone.utc)


def test_none_for_empty():
    assert parse_ru_date(None) is None
    assert parse_ru_date("") is None


def test_none_for_invalid_calendar_date():
    assert parse_ru_date("31.02.2026") is None  # 31 февраля не существует


def test_none_for_iso_format():
    """due_date исторически документировался как «ISO-дата», но на практике — ДД.ММ.ГГГГ
    (см. TaskPlanDashboard.tsx parseRu). ISO-строка не должна тихо считаться валидной —
    лучше явное «не разобрано» в отчёте, чем неверная дата."""
    assert parse_ru_date("2026-09-30") is None


def test_none_for_malformed_string():
    assert parse_ru_date("без срока") is None
    assert parse_ru_date("30.09.26") is None  # двузначный год не поддерживается
