import pytest
from app.services.calculation_engine import calculate_metric, map_to_level

def test_calculate_metric_direct():
    """Тестирование прямых метрик (чем больше, тем лучше)."""
    assert calculate_metric(15, 100, "DIRECT") == 0.15
    assert calculate_metric(100, 100, "DIRECT") == 1.0
    assert calculate_metric(0, 100, "DIRECT") == 0.0

def test_calculate_metric_inverse():
    """Тестирование инверсных метрик (чем меньше дефектов, тем лучше)."""
    assert calculate_metric(15, 100, "INVERSE") == 0.85
    assert calculate_metric(0, 100, "INVERSE") == 1.0
    assert calculate_metric(100, 100, "INVERSE") == 0.0

def test_calculate_metric_zero_denominator():
    """Тестирование исключения: знаменатель равен нулю (невозможно измерить)."""
    assert calculate_metric(15, 0, "DIRECT") == 0.0
    assert calculate_metric(15, 0, "INVERSE") == 0.0

def test_calculate_metric_bounds():
    """Тестирование выхода за границы (0.0 - 1.0)."""
    assert calculate_metric(150, 100, "DIRECT") == 1.0  # Не должно превышать 1.0
    assert calculate_metric(150, 100, "INVERSE") == 0.0 # Не должно быть меньше 0.0

def test_map_to_level():
    """Тестирование маппинга процента в качественный уровень."""
    assert map_to_level(0.85) == "Высокий уровень"
    assert map_to_level(0.81) == "Высокий уровень"
    assert map_to_level(0.65) == "Выше среднего"
    assert map_to_level(0.45) == "Средний уровень"
    assert map_to_level(0.25) == "Ниже среднего"
    assert map_to_level(0.05) == "Низкий уровень"
    assert map_to_level(0.0) == "Невозможно измерить"