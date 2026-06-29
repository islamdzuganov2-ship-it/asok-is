"""Модель качества ИС (ISO/IEC 25010): 8 характеристик и их подхарактеристики.

ВАЖНО: держать синхронно с frontend/src/constants/qualityModel.ts.
Используется сидом каталога (scripts/seed_iso25010.py) и серверной проверкой
полноты оценки (эндпоинт /assessments/{id}/finalize и /periods/summary).
"""
from __future__ import annotations

from app.models.metric_catalog import FormulaType

# (характеристика, [(подхарактеристика, тип формулы), ...])
QUALITY_MODEL: list[tuple[str, list[tuple[str, FormulaType]]]] = [
    ("Функциональная пригодность", [
        ("Функциональная полнота", FormulaType.INVERSE),
        ("Функциональная корректность", FormulaType.DIRECT),
        ("Функциональная целесообразность", FormulaType.DIRECT),
    ]),
    ("Производительность", [
        ("Временные характеристики (отклик)", FormulaType.INVERSE),
        ("Использование ресурсов", FormulaType.INVERSE),
        ("Ёмкость (пропускная способность)", FormulaType.DIRECT),
    ]),
    ("Совместимость", [
        ("Сосуществование", FormulaType.DIRECT),
        ("Интероперабельность", FormulaType.DIRECT),
    ]),
    ("Удобство использования", [
        ("Узнаваемость уместности", FormulaType.DIRECT),
        ("Изучаемость", FormulaType.DIRECT),
        ("Управляемость", FormulaType.DIRECT),
        ("Защита от ошибок пользователя", FormulaType.DIRECT),
        ("Эстетика интерфейса", FormulaType.DIRECT),
        ("Доступность (accessibility)", FormulaType.DIRECT),
    ]),
    ("Надёжность", [
        ("Зрелость (плотность дефектов)", FormulaType.INVERSE),
        ("Доступность (uptime)", FormulaType.DIRECT),
        ("Отказоустойчивость", FormulaType.DIRECT),
        ("Восстанавливаемость (MTTR)", FormulaType.INVERSE),
    ]),
    ("Защищённость", [
        ("Конфиденциальность", FormulaType.DIRECT),
        ("Целостность", FormulaType.DIRECT),
        ("Неотказуемость", FormulaType.DIRECT),
        ("Подотчётность (аудит)", FormulaType.DIRECT),
        ("Аутентичность", FormulaType.DIRECT),
    ]),
    ("Сопровождаемость", [
        ("Модульность", FormulaType.DIRECT),
        ("Повторное использование", FormulaType.DIRECT),
        ("Анализируемость", FormulaType.DIRECT),
        ("Модифицируемость", FormulaType.DIRECT),
        ("Тестируемость", FormulaType.DIRECT),
    ]),
    ("Переносимость", [
        ("Адаптируемость", FormulaType.DIRECT),
        ("Устанавливаемость", FormulaType.INVERSE),
        ("Заменяемость", FormulaType.DIRECT),
    ]),
]

# Плоский список всех пар (характеристика, подхарактеристика, формула) — 31 пара.
QUALITY_PAIRS: list[tuple[str, str, FormulaType]] = [
    (characteristic, sub, formula)
    for characteristic, subs in QUALITY_MODEL
    for sub, formula in subs
]

# Множество пар модели (для быстрой проверки «эта пара из эталона»).
QUALITY_PAIR_KEYS: set[tuple[str, str]] = {
    (characteristic, sub) for characteristic, sub, _ in QUALITY_PAIRS
}

# Эталонное число подхарактеристик — полная оценка = все они заполнены.
TOTAL_SUBS: int = len(QUALITY_PAIRS)

CHARACTERISTICS: list[str] = [characteristic for characteristic, _ in QUALITY_MODEL]
