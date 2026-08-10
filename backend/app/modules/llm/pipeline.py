"""
pipeline.py — матрица конвейера RAG и обучения (BL-009, ТЗ v18 п.1).

Зачем модуль. Про LLM-подсистему регулярно задают три вопроса: «какой у вас RAG?»,
«дообучаете ли вы модель?», «откуда модель берёт контекст?». Ответ был рассыпан по коду
(brain.recall, knowledge.relevant_terms, dataset.py, reasoning.py). Здесь он собран в ОДНУ
декларативную матрицу, из которой одинаково питаются API, UI и документация — так описание
подсистемы не может разойтись с её реализацией.

Матрица отвечает на вопрос «что откуда берётся» по каждому источнику контекста:

    источник → механизм получения → на какие этапы конвейера идёт → уровень обучения → состояние

УРОВНИ ОБУЧЕНИЯ (терминология LLM_TRAINING.md §0, здесь — единственное формальное определение):
  A — промпт-инжиниринг: знания живут в промптах и глоссарии, веса не меняются;
  B — заземление и самообучение без изменения весов: контекст подбирается из накопленных
      данных на каждый запрос (это и есть RAG подсистемы);
  C — дообучение весов (LoRA/QLoRA) на экспортированном корпусе: ОФФЛАЙН, вне рантайма.

Важное следствие, которое модуль фиксирует явно: в рантайме веса НЕ меняются. Всё, что
подсистема «узнаёт» в работе, накапливается в «резервном мозге» (brain.py) и подмешивается
как контекст — поэтому смена GGUF-модели не обнуляет накопленное.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass

# Уровни обучения.
LEVEL_A = "A"
LEVEL_B = "B"
LEVEL_C = "C"

LEVELS: dict[str, dict] = {
    LEVEL_A: {
        "code": LEVEL_A,
        "title": "Промпт-инжиниринг",
        "weights_change": False,
        "runtime": True,
        "description": "Знания и правила заданы промптами, глоссарием и чек-листами; "
                       "применяются на каждом запросе, веса модели не меняются.",
    },
    LEVEL_B: {
        "code": LEVEL_B,
        "title": "Заземление и самообучение контекстом (RAG)",
        "weights_change": False,
        "runtime": True,
        "description": "Контекст подбирается под запрос из накопленных данных контура и памяти "
                       "рассуждений; качество растёт по мере накопления данных, веса не меняются.",
    },
    LEVEL_C: {
        "code": LEVEL_C,
        "title": "Дообучение весов (LoRA/QLoRA)",
        "weights_change": True,
        "runtime": False,
        "description": "Оффлайн-процедура на экспортированном корпусе с последующей сборкой GGUF; "
                       "в рантайме системы НЕ выполняется и автоматически не запускается.",
    },
}

# Состояния строки матрицы.
ACTIVE = "активен"           # работает в каждом запросе
ON_DEMAND = "по запросу"     # работает при ручном запуске/наличии условия
OFFLINE = "оффлайн"          # вне рантайма приложения


@dataclass(frozen=True)
class ContextSource:
    """Строка матрицы: один источник контекста или обучающего сигнала."""

    code: str
    title: str
    mechanism: str            # как именно извлекается (ЭТО и есть ответ «какой RAG»)
    storage: str              # где физически лежит
    feeds: tuple[str, ...]    # на какие этапы конвейера идёт (коды STAGES) или «—»
    level: str                # A | B | C
    state: str                # активен | по запросу | оффлайн
    module: str               # где реализовано (файл)
    note: str = ""

    def to_dict(self) -> dict:
        d = asdict(self)
        d["feeds"] = list(self.feeds)
        d["level_title"] = LEVELS[self.level]["title"]
        return d


# ─── Матрица источников ───────────────────────────────────────────────────────────────
# Порядок: сначала то, что работает на каждом запросе, затем — по запросу и оффлайн.
MATRIX: tuple[ContextSource, ...] = (
    ContextSource(
        code="system_prompt",
        title="Системный промпт персоны",
        mechanism="Сборка из общих блоков (идентичность + правила честности + роль адресата "
                  "+ формат) по роли пользователя",
        storage="Код (personas.py)",
        feeds=("E1", "E2", "E2Q", "E3", "E5", "E7"),
        level=LEVEL_A, state=ACTIVE, module="modules/llm/personas.py",
        note="Правила честности физически общие для всех персон — ослабить их в одной роли нельзя.",
    ),
    ContextSource(
        code="glossary",
        title="Доменный глоссарий ISO 25010",
        mechanism="Выборка по вхождению названия характеристики во входные данные "
                  "(лексическое сопоставление, без эмбеддингов)",
        storage="Код (knowledge.py), статическая выгрузка стандарта",
        feeds=("E1", "E2", "E2Q", "E3", "E5", "E7"),
        level=LEVEL_A, state=ACTIVE, module="modules/llm/knowledge.py",
        note="Даёт определения и типовые причины просадки; чисел не добавляет.",
    ),
    ContextSource(
        code="principles",
        title="Чек-лист управленческих принципов",
        mechanism="Подмешивание требований к резюме для персон с apply_principles "
                  "+ детерминированная пост-проверка отражения принципов",
        storage="Код (principles.py)",
        feeds=("E7",),
        level=LEVEL_A, state=ACTIVE, module="modules/llm/principles.py",
        note="Применяется к резюме топ-менеджменту; названия методологий в вывод не попадают.",
    ),
    ContextSource(
        code="contour_data",
        title="Первичные данные контура (суждения, риски, меры, метрики)",
        mechanism="Выборка из БД по периоду и характеристикам запроса "
                  "(SQL-фильтр по характеристикам просевших областей)",
        storage="PostgreSQL",
        feeds=("E0", "E1", "E2", "E2Q", "E3", "E5", "E7"),
        level=LEVEL_B, state=ACTIVE, module="modules/assessment/router.py, modules/risk",
        note="Единственный источник ЧИСЕЛ: grounding-контроль сверяет проценты вывода с ним.",
    ),
    ContextSource(
        code="history",
        title="История прошлых периодов ИС",
        mechanism="Выборка суждений прошлых периодов той же ИС (SQL по system_id)",
        storage="PostgreSQL",
        feeds=("E0", "E2Q", "E3", "E7"),
        level=LEVEL_B, state=ACTIVE, module="modules/assessment/router.py",
        note="Даёт преемственность выводов между периодами.",
    ),
    ContextSource(
        code="brain_memory",
        title="Память рассуждений «резервного мозга»",
        mechanism="Припоминание по скорингу: совпадение ИС (+3), пересечение характеристик (+2 "
                  "за каждую), лексическое совпадение (+1), поправка на оценку человека; "
                  "отклонённое человеком исключается. Топ-k подмешивается к истории",
        storage="Файлы вне модели: models/llm_brain/memory.jsonl",
        feeds=("E0", "E2Q", "E3", "E7"),
        level=LEVEL_B, state=ACTIVE, module="modules/llm/brain.py",
        note="ЭТО и есть механизм RAG подсистемы. Живёт вне весов → переживает смену модели.",
    ),
    ContextSource(
        code="human_feedback",
        title="Обратная связь человека по заключениям",
        mechanism="Вердикт принять/отклонить/исправить по отпечатку заключения; влияет на "
                  "приоритет припоминания и пополняет корпус «золотыми» примерами",
        storage="Файлы вне модели: models/llm_brain/feedback.jsonl",
        feeds=("E7",),
        level=LEVEL_B, state=ACTIVE, module="modules/llm/brain.py",
        note="Единственный контур, где оценка человека возвращается в поведение системы.",
    ),
    ContextSource(
        code="rules_gate",
        title="Вердикт детерминированного движка правил",
        mechanism="Пороговые правила на посчитанных метриках (Severity/Coverage/Regression)",
        storage="Код (gate.py) + метрики из PostgreSQL",
        feeds=("E0", "E4", "E7"),
        level=LEVEL_A, state=ACTIVE, module="modules/llm/gate.py",
        note="Решение выносит Python; LLM его объясняет и не может переопределить.",
    ),
    ContextSource(
        code="decision_matrices",
        title="Матрицы принятия решений",
        mechanism="Табличный поиск по ключам (серьёзность × критичность; уверенность × откаты; "
                  "покрытие × наличие источников)",
        storage="Код (decisions.py)",
        feeds=("E5", "E7"),
        level=LEVEL_A, state=ACTIVE, module="modules/llm/decisions.py",
        note="Уровень решения, срок, адресат и допустимость выноса на правление.",
    ),
    ContextSource(
        code="sft_corpus",
        title="Обучающий корпус (SFT)",
        mechanism="Экспорт суждений и детерминированных трасс рассуждения в JSONL "
                  "(instruction / reasoning / output) + правки эксперта",
        storage="Файлы вне модели: models/llm_brain/judgments_sft.jsonl, corpus.jsonl",
        feeds=("—",),
        level=LEVEL_C, state=ON_DEMAND, module="modules/llm/dataset.py",
        note="Запускается командой; корпус пополняется, но обучение из него не стартует само.",
    ),
    ContextSource(
        code="lora_finetune",
        title="Дообучение весов (LoRA/QLoRA) и сборка GGUF",
        mechanism="Оффлайн-процедура на GPU: обучение адаптера → слияние → конвертация "
                  "в GGUF → квантизация → подмена файла модели",
        storage="Вне системы (среда обучения), результат — файл в models/llm/",
        feeds=("—",),
        level=LEVEL_C, state=OFFLINE, module="docs/LLM_TRAINING.md",
        note="В рантайме НЕ выполняется: непрерывного дообучения на боевых данных нет.",
    ),
)

BY_CODE: dict[str, ContextSource] = {s.code: s for s in MATRIX}


def active_sources() -> tuple[ContextSource, ...]:
    """Источники, работающие на каждом запросе (то, что реально формирует контекст)."""
    return tuple(s for s in MATRIX if s.state == ACTIVE)


def sources_for_stage(stage_code: str) -> tuple[ContextSource, ...]:
    """Какие источники питают конкретный этап конвейера (для трассы и объяснения вывода)."""
    return tuple(s for s in MATRIX if stage_code in s.feeds)


def continuous_finetuning_enabled() -> bool:
    """Идёт ли дообучение весов в рантайме.

    Всегда False по построению: уровень C объявлен оффлайновым, и в коде нет пути, который
    запускал бы обучение из процесса приложения. Функция существует, чтобы этот факт можно
    было ПРОВЕРИТЬ тестом и показать в отчёте, а не подтверждать словами.
    """
    return any(LEVELS[s.level]["runtime"] and LEVELS[s.level]["weights_change"] for s in MATRIX)


def summary() -> dict:
    """Матрица целиком — для API, UI и генерации документации."""
    return {
        "levels": list(LEVELS.values()),
        "sources": [s.to_dict() for s in MATRIX],
        "active_count": len(active_sources()),
        "continuous_finetuning": continuous_finetuning_enabled(),
        "rag_mechanism": BY_CODE["brain_memory"].mechanism,
    }
