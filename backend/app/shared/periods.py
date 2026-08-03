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


# Статусы периода оценки: черновик → есть расчёт → завершена (закрыта на правку, ТЗ v16 T-47).
STATUS_DRAFT = "DRAFT"
STATUS_CALCULATED = "CALCULATED"
STATUS_COMPLETE = "COMPLETE"

# Единый текст отказа: правка завершённой оценки идёт только через явную разблокировку,
# иначе итоги дашбордов менялись бы задним числом (ручной ввод, API значений, импорт Excel).
PERIOD_LOCKED_MESSAGE = (
    "Оценка завершена и закрыта на правку. Откройте её на корректировку "
    "(«Внесение данных» → «Корректировка оценки»), затем завершите заново."
)


def is_period_locked(status: str | None) -> bool:
    """Завершённый период закрыт на изменение значений (до POST /assessments/{id}/reopen)."""
    return status == STATUS_COMPLETE
