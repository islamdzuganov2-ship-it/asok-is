"""Модель качества СИИ по ГОСТ Р 59898-2021 — машиночитаемый каталог (BL-001/BL-003).

Иерархия: группа → характеристика (ГОСТ Р 59276) → субхарактеристика → метрика.
Каждой из 37 субхарактеристик назначены machine-readable `metric_kind` и схема входов
(`inputs_schema`) — единый источник истины для API /ai-assessments/ai-model, расчётного
движка (ai_calculation.py) и фронта (frontend/src/constants/aiQualityModel.ts — держать синхронно).

E1 (MVP): поддержаны RATIO_DIRECT/RATIO_INVERSE (A/B), классификация
(ACCURACY/PRECISION/RECALL/SPECIFICITY/F1) и EXPERT_SCALE (экспертная шкала 0–100 для
субхарактеристик без жёстких формул в стандарте). Виды E2 (MSE/MAE/AUC/NDCG/PSNR/SSIM)
задекларированы в METRIC_KINDS, но в каталоге E1 не назначаются.

Намеренно НЕ импортирует ORM-модели (независимость констант, как quality_model.py).
"""
from __future__ import annotations

# Все поддерживаемые виды метрик (E1 + задел E2). Схема входов — имена полей `inputs`.
METRIC_KINDS: dict[str, list[str]] = {
    "RATIO_DIRECT": ["A", "B"],          # X = A/B
    "RATIO_INVERSE": ["A", "B"],         # X = 1 − A/B
    "ACCURACY": ["TP", "TN", "FP", "FN"],
    "PRECISION": ["TP", "FP"],
    "RECALL": ["TP", "FN"],
    "SPECIFICITY": ["TN", "FP"],
    "F1": ["TP", "FP", "FN"],
    "EXPERT_SCALE": ["score"],           # экспертная оценка 0–100 (%)
    # E2 (считаются движком; массивы вводятся списком/CSV):
    "MSE": ["y", "y_hat"],
    "MAE": ["y", "y_hat"],
    "AUC_ROC": ["curve"],
    "AUC_PRC": ["curve"],
    "NDCG": ["rel"],
    "PSNR": ["I", "I_hat", "max_i"],
    "SSIM": ["I", "I_hat"],
}

# (субхарактеристика, metric_kind, is_ai_specific, подсказка по входам)
Sub = tuple[str, str, bool, str]

# Группа → [(характеристика, [субхарактеристики])]
# Источник: таблица 2 ГОСТ Р 59898-2021 (см. ТЗ_Модуль_Качества_СИИ_v1, часть B2).
AI_QUALITY_MODEL: list[tuple[str, list[tuple[str, list[Sub]]]]] = [
    ("Функциональность", [
        ("Функциональные возможности", [
            ("Функциональная пригодность", "RATIO_DIRECT", False,
             "A — задач, решённых корректно; B — всего задач в наборе"),
            ("Функциональная корректность", "ACCURACY", False,
             "Матрица ошибок классификации на тестовом наборе (TP/TN/FP/FN)"),
            ("Согласованность (compliance)", "RATIO_DIRECT", False,
             "A — выполненных требований соответствия; B — всего требований"),
            ("Функциональная полнота", "RATIO_INVERSE", False,
             "A — нереализованных требований; B — всего требований"),
            ("Способность к самообучению", "EXPERT_SCALE", True,
             "Экспертная оценка 0–100: качество дообучения на новых данных"),
        ]),
        ("Способность к взаимодействию", [
            ("Соответствие (co-existence)", "RATIO_DIRECT", False,
             "A — окружений без конфликтов; B — всего совместных окружений"),
            ("Функциональная совместимость (interoperability)", "RATIO_DIRECT", False,
             "A — успешных интеграций; B — всего интеграций"),
            ("Контролируемость (controllability)", "EXPERT_SCALE", True,
             "Экспертная оценка 0–100: возможность вмешательства/остановки/override"),
        ]),
        ("Уровень производительности", [
            ("Характер изменения во времени", "RATIO_INVERSE", False,
             "A — замеров с превышением допустимого времени; B — всего замеров"),
            ("Характер изменения ресурсов", "RATIO_INVERSE", False,
             "A — замеров с перерасходом ресурсов; B — всего замеров"),
            ("Производительные возможности (capacity)", "RATIO_DIRECT", False,
             "A — достигнутая пропускная способность; B — требуемая"),
        ]),
        ("Мобильность", [
            ("Адаптируемость", "RATIO_DIRECT", False,
             "A — поддержанных сред/платформ; B — требуемых"),
            ("Простота внедрения (installability)", "RATIO_INVERSE", False,
             "A — неуспешных установок; B — всего установок"),
            ("Заменяемость", "RATIO_DIRECT", False,
             "A — компонентов с проверенной заменой; B — всего компонентов"),
        ]),
        ("Практичность", [
            ("Понятность/объяснимость (explainability)", "EXPERT_SCALE", True,
             "Экспертная оценка 0–100: объяснимость решений модели для пользователя"),
            ("Изучаемость", "RATIO_DIRECT", False,
             "A — пользователей, освоивших сценарии; B — всего обученных"),
            ("Простота использования", "RATIO_DIRECT", False,
             "A — сценариев, пройденных без ошибок; B — всего сценариев юзабилити-теста"),
            ("Защищённость от ошибки пользователя", "RATIO_DIRECT", False,
             "A — перехваченных ошибочных действий; B — всего ошибочных действий"),
            ("Эстетика интерфейса", "EXPERT_SCALE", False,
             "Экспертная оценка 0–100 по чек-листу дизайн-системы"),
            ("Доступность", "RATIO_DIRECT", False,
             "A — выполненных требований a11y; B — всего требований"),
            ("Взаимодействие (collaborability)", "EXPERT_SCALE", True,
             "Экспертная оценка 0–100: качество совместной работы человек↔СИИ"),
        ]),
    ]),
    ("Сопровождаемость", [
        ("Сопровождаемость", [
            ("Анализируемость", "RATIO_DIRECT", False,
             "A — инцидентов с установленной причиной; B — всего инцидентов"),
            ("Изменяемость", "RATIO_DIRECT", False,
             "A — изменений без дефектов; B — всего изменений"),
            ("Устойчивость (stability)", "RATIO_INVERSE", False,
             "A — изменений с регрессией; B — всего изменений"),
            ("Тестируемость", "RATIO_DIRECT", False,
             "A — покрытых автотестами компонентов; B — всего компонентов"),
            ("Модульность", "RATIO_DIRECT", False,
             "A — слабосвязанных модулей; B — всего модулей"),
            ("Настраиваемость (evolution)", "EXPERT_SCALE", True,
             "Экспертная оценка 0–100: адаптация модели без полного переобучения"),
        ]),
    ]),
    ("Надёжность", [
        ("Надёжность", [
            ("Стабильность (maturity)", "RATIO_INVERSE", False,
             "A — дефектов за период; B — объём (функц. точки/кейсы)"),
            ("Отказоустойчивость", "RATIO_DIRECT", False,
             "A — отказов, обработанных без остановки; B — всего отказов"),
            ("Восстанавливаемость", "RATIO_INVERSE", False,
             "A — инцидентов с восстановлением дольше норматива; B — всего инцидентов"),
            ("Робастность (robustness)", "RATIO_DIRECT", True,
             "A — выдержанных возмущённых/состязательных входов; B — всего в наборе атак"),
        ]),
    ]),
    ("Безопасность", [
        ("Защищённость", [
            ("Конфиденциальность", "RATIO_DIRECT", False,
             "A — пройденных проверок контроля доступа; B — всего проверок"),
            ("Целостность", "RATIO_DIRECT", False,
             "A — пройденных проверок целостности данных/модели; B — всего проверок"),
            ("Неотказуемость", "RATIO_DIRECT", False,
             "A — операций с доказуемым следом; B — всего критичных операций"),
            ("Подотчётность", "RATIO_DIRECT", False,
             "A — действий, прослеживаемых в аудите; B — всего проверенных действий"),
            ("Подлинность", "RATIO_DIRECT", False,
             "A — субъектов с подтверждённой подлинностью; B — всего субъектов"),
            ("Приватность (privacy)", "RATIO_DIRECT", True,
             "A — датасетов/полей под контролем ПДн; B — всего с персональными данными"),
        ]),
    ]),
]

# --- Производные структуры ---

# Плоский список: (группа, характеристика, субхарактеристика, kind, ai_specific, hint)
AI_QUALITY_FLAT: list[tuple[str, str, str, str, bool, str]] = [
    (group, char, sub, kind, ai, hint)
    for group, chars in AI_QUALITY_MODEL
    for char, subs in chars
    for sub, kind, ai, hint in subs
]

AI_PAIR_KEYS: set[tuple[str, str]] = {(c, s) for _, c, s, _, _, _ in AI_QUALITY_FLAT}
AI_TOTAL_SUBS: int = len(AI_QUALITY_FLAT)          # 37
AI_GROUPS: list[str] = [g for g, _ in AI_QUALITY_MODEL]
AI_CHARACTERISTICS: list[str] = [c for _, chars in AI_QUALITY_MODEL for c, _ in chars]
AI_SPECIFIC_COUNT: int = sum(1 for *_r, ai, _ in AI_QUALITY_FLAT if ai)  # 7

# Быстрый доступ: (характеристика, субхарактеристика) → (kind, inputs_schema, ai, hint)
AI_SUB_INDEX: dict[tuple[str, str], dict] = {
    (c, s): {"metric_kind": k, "inputs_schema": METRIC_KINDS[k], "is_ai_specific": ai, "hint": hint}
    for _, c, s, k, ai, hint in AI_QUALITY_FLAT
}


def ai_model_tree() -> list[dict]:
    """Дерево модели для API /ai-assessments/ai-model (и зеркала на фронте)."""
    return [
        {
            "group": group,
            "characteristics": [
                {
                    "title": char,
                    "subs": [
                        {
                            "name": sub,
                            "metric_kind": kind,
                            "inputs_schema": METRIC_KINDS[kind],
                            "is_ai_specific": ai,
                            "hint": hint,
                        }
                        for sub, kind, ai, hint in subs
                    ],
                }
                for char, subs in chars
            ],
        }
        for group, chars in AI_QUALITY_MODEL
    ]
