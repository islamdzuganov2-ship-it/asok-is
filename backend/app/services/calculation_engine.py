def calculate_metric_value(a: float, b: float, formula_type: str):
    if b == 0:
        return 0.0, "Невозможно измерить"
    
    try:
        if formula_type == "DIRECT":
            x = a / b
        else: # INVERSE
            x = 1 - (a / b)
        
        # Ограничиваем от 0 до 1
        x = max(0.0, min(1.0, x))
        
        # Определение уровня
        p = x * 100
        if p >= 81: level = "Высокий уровень"
        elif p >= 61: level = "Уровень выше среднего"
        elif p >= 41: level = "Средний уровень"
        elif p >= 21: level = "Уровень ниже среднего"
        elif p > 0: level = "Низкий уровень"
        else: level = "Невозможно измерить"
            
        return x, level
    except Exception:
        return 0.0, "Ошибка расчета"