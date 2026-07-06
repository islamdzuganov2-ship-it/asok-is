"""Хронология периодов оценки («Qn-YYYY»).

«Последний период» нельзя выбирать по created_at (сиды пишут все периоды одной транзакцией —
метки совпадают) или по строке (лексикографически «Q4-2025» > «Q2-2026»). Единственный честный
порядок — семантический: (год, квартал). Используется дашбордами assessment и reporting (DEF-13).
"""
from __future__ import annotations

import re

_PERIOD_RE = re.compile(r"Q([1-4])[\s-]?(\d{4})")


def period_sort_key(period: str | None) -> tuple[int, int]:
    """Ключ сортировки периода: (год, квартал); нераспознанное — в самый конец (0, 0)."""
    m = _PERIOD_RE.search(period or "")
    return (int(m.group(2)), int(m.group(1))) if m else (0, 0)
