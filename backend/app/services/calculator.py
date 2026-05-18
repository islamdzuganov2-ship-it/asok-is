```python
"""
Расчётное ядро АСОК ИС. Алгоритм вычисления X по МК_8.1.
Все вычисления строго на Backend. БД хранит только финальный результат.
Критерий приёмки: результаты X совпадают с контрольным Excel на 100%.
"""
from dataclasses import dataclass

_QUALITY_THRESHOLDS: list[tuple[float, str]] = [
    (0.81, "Высокий уровень"),
    (0.61, "Уровень выше среднего"),
    (0.41, "Средний уровень"),
    (0.21, "Уровень ниже среднего"),
    (0.0,  "Низкий уровень"),
]


@dataclass(frozen=True)
class CalculationResult:
    x: float
    quality_level: str


def calculate_x(
    a: float | None,
    b: float | None,
    formula_type: str,
) -> CalculationResult:
    """
    Вычисляет нормализованное значение X и уровень качества.

    DIRECT:  X = clamp(a / b, 0, 1)
    INVERSE: X = clamp(1 - a / b, 0, 1)
    b == 0 или None → "Невозможно измерить"

    Args:
        a: Числитель (факт). None если не введено.
        b: Знаменатель (план). None если не введено.
        formula_type: 'DIRECT' или 'INVERSE'.

    Returns:
        CalculationResult(x, quality_level).

    Raises:
        ValueError: Неизвестный formula_type.
    """
    if formula_type not in ("DIRECT", "INVERSE"):
        raise ValueError(f"Неизвестный тип формулы: {formula_type!r}")

    if a is None or b is None or b == 0:
        return CalculationResult(x=0.0, quality_level="Невозможно измерить")

    raw = 1.0 - (float(a) / float(b)) if formula_type == "INVERSE" else float(a) / float(b)
    x = max(0.0, min(1.0, raw))
    return CalculationResult(x=round(x, 4), quality_level=_map_to_quality_level(x))


def _map_to_quality_level(x: float) -> str:
    if x == 0.0:
        return "Невозможно измерить"
    for threshold, level in _QUALITY_THRESHOLDS:
        if x >= threshold:
            return level
    return "Невозможно измерить"
```
