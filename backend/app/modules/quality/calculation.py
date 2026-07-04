"""
Расчётный движок домена quality (ТЗ v13): коэффициент X и качественный уровень.
Каноническое место; app.services.calculation_engine — shim отсюда.
"""
from typing import Literal


def calculate_metric(a: float, b: float, formula_type: Literal["DIRECT", "INVERSE"]) -> float:
    """
    Вычисляет итоговый коэффициент X (0.0 - 1.0).
    Логика согласно ТЗ ч.1, стр. 2.
    """
    if b == 0:
        return 0.0  # Обработка исключения "Невозможно измерить"

    if formula_type == "INVERSE":
        x = 1 - (a / b)
    else:
        x = a / b

    return round(max(0.0, min(1.0, x)), 4)


def map_to_level(x: float) -> str:
    """
    Маппинг коэффициента в качественный уровень согласно ТЗ ч.1, стр. 3.
    """
    if x >= 0.81: return "Высокий уровень"
    if x >= 0.61: return "Выше среднего"
    if x >= 0.41: return "Средний уровень"
    if x >= 0.21: return "Ниже среднего"
    if x > 0: return "Низкий уровень"
    return "Невозможно измерить"
