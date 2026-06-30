"""Модель качества ИС (ISO/IEC 25010): 8 характеристик и их подхарактеристики.

ВАЖНО: держать синхронно с frontend/src/constants/qualityModel.ts.
Используется сидом каталога (scripts/seed_iso25010.py) и серверной проверкой
полноты оценки (эндпоинт /assessments/{id}/finalize и /periods/summary).

Намеренно НЕ импортирует ORM-модели: тип формулы хранится строкой ("DIRECT"/"INVERSE"),
чтобы модуль констант был независим от порядка импорта и не вызывал циклический импорт
(metric_catalog ↔ db.base). Сид конвертирует строку в FormulaType.
"""
from __future__ import annotations

from typing import Literal

Formula = Literal["DIRECT", "INVERSE"]
DIRECT: Formula = "DIRECT"
INVERSE: Formula = "INVERSE"

# (характеристика, [(подхарактеристика, тип формулы), ...])
QUALITY_MODEL: list[tuple[str, list[tuple[str, Formula]]]] = [
    ("Функциональная пригодность", [
        ("Функциональная полнота", INVERSE),
        ("Функциональная корректность", DIRECT),
        ("Функциональная целесообразность", DIRECT),
    ]),
    ("Производительность", [
        ("Временные характеристики (отклик)", INVERSE),
        ("Использование ресурсов", INVERSE),
        ("Ёмкость (пропускная способность)", DIRECT),
    ]),
    ("Совместимость", [
        ("Сосуществование", DIRECT),
        ("Интероперабельность", DIRECT),
    ]),
    ("Удобство использования", [
        ("Узнаваемость уместности", DIRECT),
        ("Изучаемость", DIRECT),
        ("Управляемость", DIRECT),
        ("Защита от ошибок пользователя", DIRECT),
        ("Эстетика интерфейса", DIRECT),
        ("Доступность (accessibility)", DIRECT),
    ]),
    ("Надёжность", [
        ("Зрелость (плотность дефектов)", INVERSE),
        ("Доступность (uptime)", DIRECT),
        ("Отказоустойчивость", DIRECT),
        ("Восстанавливаемость (MTTR)", INVERSE),
    ]),
    ("Защищённость", [
        ("Конфиденциальность", DIRECT),
        ("Целостность", DIRECT),
        ("Неотказуемость", DIRECT),
        ("Подотчётность (аудит)", DIRECT),
        ("Аутентичность", DIRECT),
    ]),
    ("Сопровождаемость", [
        ("Модульность", DIRECT),
        ("Повторное использование", DIRECT),
        ("Анализируемость", DIRECT),
        ("Модифицируемость", DIRECT),
        ("Тестируемость", DIRECT),
    ]),
    ("Переносимость", [
        ("Адаптируемость", DIRECT),
        ("Устанавливаемость", INVERSE),
        ("Заменяемость", DIRECT),
    ]),
]

# Плоский список всех пар (характеристика, подхарактеристика, формула) — 31 пара.
QUALITY_PAIRS: list[tuple[str, str, Formula]] = [
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
