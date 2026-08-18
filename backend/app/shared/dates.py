"""Дата как реальный тип (ТЗ v19 УК-36) — общая точка разбора для write-путей (governance.service)
и разовых скриптов (backfill_due_dates.py), чтобы формат не разошёлся между ними.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone

_RU_DATE_RE = re.compile(r"^(\d{2})\.(\d{2})\.(\d{4})$")


def parse_ru_date(raw: str | None) -> datetime | None:
    """«30.09.2026» → datetime(2026, 9, 30, tzinfo=UTC). None для пустых/нераспознанных строк."""
    if not raw:
        return None
    m = _RU_DATE_RE.match(raw.strip())
    if not m:
        return None
    day, month, year = (int(x) for x in m.groups())
    try:
        return datetime(year, month, day, tzinfo=timezone.utc)
    except ValueError:
        return None
