"""Форматирование денег для текстов уведомлений и записок (не для API — там числа)."""
from __future__ import annotations


def fmt_rub(value: float | int | None) -> str:
    """1234567.8 → «1 234 568 ₽» (неразрывные пробелы между разрядами, без копеек)."""
    if value is None:
        return "—"
    return f"{round(float(value)):,}".replace(",", " ") + " ₽"
