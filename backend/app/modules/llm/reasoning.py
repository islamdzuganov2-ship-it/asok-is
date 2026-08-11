"""
reasoning.py — конвейер многоаспектного аналитического рассуждения LLM (BL-005, ТЗ v13, домен llm).

Прежде чем вынести заключение руководителю (ЛПР), модель проходит этапы:

    Э0   Факты входа        — инвентаризация фактов входа (только переданное; чего нет — «отсутствует»)
    Э1   Проблема           — что именно просело
    Э2   Первопричина       — ЛЕСТНИЦА «ПОЧЕМУ» до управляемой причины, а не симптома
    Э2.5 Уточняющие вопросы — доуточнение контекста по пробелам данных (ТЗ v18 п.7)
    Э3   Ролевые точки зрения — экспертные линзы (≥3 точек зрения: CIO, качество, риски, ИБ)
    Э4   Контроль этапов    — встроенное качество: grounding-проверка чисел каждого этапа
    Э5   Синтез мер         — мера → закрываемый риск, только из переданных мер/минимизаций
    Э6   Саморефлексия      — чего не хватает, где fallback, уверенность
    Э7   Заключение ЛПР     — контракт блоков, ТОЛЬКО после Э0–Э6

Методология этапов — внутренний «скелет» рассуждения; в текст, видимый пользователю,
названия методологических школ и их термины НЕ выводятся: LLM наполняет скелет содержанием
из переданных данных и доменного глоссария (knowledge.py).

РОЛЕВОЙ СЛОЙ (ТЗ v18). Конвейер параметризуется ПЕРСОНОЙ адресата (personas.py): она задаёт
системный промпт, набор линз, глубину лестницы «почему», бюджет ответа и применение чек-листа
управленческих принципов (principles.py). Один конвейер — разные адресаты, без ветвления логики.

МАТРИЦЫ РЕШЕНИЙ (ТЗ v18). Уровень решения, срок, адресат и допустимость выноса на правление
считает decisions.py по детерминированным таблицам — LLM их ОБЪЯСНЯЕТ, но не переопределяет
(тот же инвариант, что у gate.py).

Инженерные принципы:
  • grounding: проценты в выводе каждого этапа обязаны присутствовать во входе, иначе этап
    заменяется детерминированным fallback (контроль качества = «остановись и почини»);
  • деградация: без модели/при ошибке конвейер полностью детерминирован и всегда даёт трассу
    и заключение (честное, без выдумок);
  • экономия CPU: до 4 LLM-проходов (Э1+Э2, Э2.5, Э3, Э5+Э7) с секционными маркерами вместо 9;
    проход Э2.5 выполняется ТОЛЬКО при наличии пробелов данных — иначе спрашивать нечего.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field

from app.modules.llm import brain, decisions, personas, principles, service
from app.modules.llm.knowledge import relevant_terms
from app.modules.llm.personas import Persona
from app.modules.llm.prompts import (
    REASONING_LENSES,
    REASONING_PASS_ANALYSIS,
    REASONING_PASS_CONCLUSION_ONLY,
    REASONING_PASS_LENSES,
    REASONING_PASS_QA,
    REASONING_PASS_SYNTHESIS,
    checklist_for,
    reasoning_system_prompt,
)

logger = logging.getLogger(__name__)

# Порядок и названия этапов конвейера (код, заголовок).
# E2Q вставлен между E2 и E3 намеренно с буквенным кодом: сквозная перенумерация сломала бы
# ссылки на этапы в трассах, уже сохранённых в «мозге» и в обучающем корпусе.
STAGES: list[tuple[str, str]] = [
    ("E0", "Факты входа"),
    ("E1", "Постановка проблемы"),
    ("E2", "Первопричина"),
    ("E2Q", "Уточняющие вопросы"),
    ("E3", "Ролевые точки зрения"),
    ("E4", "Контроль достоверности этапов"),
    ("E5", "Синтез мер"),
    ("E6", "Саморефлексия и оговорки"),
    ("E7", "Заключение для руководителя (ЛПР)"),
]

_STAGE_TITLES = dict(STAGES)


@dataclass(frozen=True)
class ReasoningInput:
    """Входы конвейера — три источника контура + метрики, история (RAG) и сработавшие правила."""
    system_name: str
    period_label: str
    judgments_block: str = ""   # профессиональные суждения (характеристика / подхар.: текст)
    risks_block: str = ""       # риски из базы ("- титул: мера минимизации")
    measures_block: str = ""    # карточки мер (сводка), может отсутствовать
    metrics_block: str = ""     # расчётные метрики ("характеристика | метрика | %")
    history_block: str = ""     # суждения/выводы прошлых периодов (преемственность)
    rules_block: str = ""       # сработавшие детерминированные правила движка (см. modules/llm/gate.py)
    # ── Входы матриц решений (ТЗ v18). Значения по умолчанию сохраняют прежнее поведение:
    # без критичности и без счётчиков покрытия триаж даёт самый мягкий уровень решения.
    severity: str = "none"      # вердикт движка правил (gate.GateResult.severity)
    criticality: str = ""       # класс критичности ИС (MISSION/BUSINESS CRITICAL/OPERATIONAL)
    measured_subs: int = 0      # измерено подхарактеристик
    total_subs: int = 0         # всего подхарактеристик в модели качества


@dataclass
class LensView:
    code: str
    title: str
    question: str
    iso_ref: str
    view: str
    used_llm: bool = False


@dataclass
class StageResult:
    code: str
    title: str
    content: str
    used_llm: bool = False
    grounded: bool = True       # True: прошёл grounding-проверку ИЛИ детерминирован по построению
    fell_back: bool = False     # True: LLM-вывод отбракован/недоступен → детерминированный текст


@dataclass
class QuestionAnswer:
    """Уточняющий вопрос по пробелу данных и ответ на него (этап Э2.5)."""
    number: int
    question: str
    answer: str
    resolved: bool = False   # True: ответ найден во входных данных, а не «данные отсутствуют»


@dataclass
class ReasoningTrace:
    """Аудируемая трасса конвейера: этапы, линзы, заключение, уверенность."""
    input: ReasoningInput
    stages: list[StageResult] = field(default_factory=list)
    lenses: list[LensView] = field(default_factory=list)
    conclusion: str = ""
    confidence: str = "низкая"          # низкая | средняя | высокая (детерминированно из полноты данных)
    llm_used: bool = False              # хотя бы один этап принят от LLM
    # ── ТЗ v18 ───────────────────────────────────────────────────────────────────────
    persona: str = personas.DEFAULT_PERSONA_CODE   # код персоны адресата
    why_chain: list[str] = field(default_factory=list)  # ступени лестницы «почему» (Э2)
    questions: list[QuestionAnswer] = field(default_factory=list)  # уточняющие вопросы (Э2.5)
    decisions: dict = field(default_factory=dict)        # решения матриц (decisions.py)
    principles_audit: dict = field(default_factory=dict)  # признаки применения принципов (Э7)

    @property
    def why_depth(self) -> int:
        """Число ДОКАЗАННЫХ ступеней «почему» (ступень-заглушка «данных нет» не считается)."""
        return len(self.why_chain)

    def stage(self, code: str) -> StageResult | None:
        return next((s for s in self.stages if s.code == code), None)

    def to_dict(self) -> dict:
        return {
            "stages": [
                {"code": s.code, "title": s.title, "content": s.content,
                 "used_llm": s.used_llm, "grounded": s.grounded, "fell_back": s.fell_back}
                for s in self.stages
            ],
            "lenses": [
                {"code": lens.code, "title": lens.title, "iso_ref": lens.iso_ref,
                 "view": lens.view, "used_llm": lens.used_llm}
                for lens in self.lenses
            ],
            "conclusion": self.conclusion,
            "confidence": self.confidence,
            "llm_used": self.llm_used,
            "persona": self.persona,
            "why_chain": list(self.why_chain),
            "why_depth": self.why_depth,
            "questions": [
                {"number": q.number, "question": q.question, "answer": q.answer,
                 "resolved": q.resolved}
                for q in self.questions
            ],
            "decisions": self.decisions,
            "principles": self.principles_audit,
        }

    def as_training_block(self) -> str:
        """Компактная трасса Э1–Э6 для SFT-корпуса (уровень C, LLM_TRAINING §9).

        Э2.5 включён намеренно: примеры должны учить модель САМУ задавать уточняющие вопросы
        к переданным данным и честно отвечать «данные отсутствуют», а не сразу выдавать вывод.
        """
        parts: list[str] = []
        for code in ("E1", "E2", "E2Q"):
            s = self.stage(code)
            if s:
                parts.append(f"[{s.title}] {s.content}")
        for lens in self.lenses:
            parts.append(f"[Линза: {lens.title}] {lens.view}")
        for code in ("E5", "E6"):
            s = self.stage(code)
            if s:
                parts.append(f"[{s.title}] {s.content}")
        return "\n".join(parts)


# ─── Вспомогательные: разбор секций и grounding ──────────────────────────────────────

_ABSENT = "данные отсутствуют"


def _header_re(header: str) -> re.Pattern:
    """Толерантный заголовок секции: markdown/нумерация/кавычки/регистр/тире вместо двоеточия."""
    return re.compile(
        rf"^[ \t#*>\-\d.\)]*(?:секция\s+)?[«\"']?{re.escape(header)}[»\"']?[ \t*]*[:：—-]+",
        flags=re.IGNORECASE | re.MULTILINE,
    )


def _split_sections(text: str, headers: dict[str, list[str]]) -> dict[str, str]:
    """Режет ответ LLM на секции по известным заголовкам (устойчиво к формату мелких моделей).

    headers: ключ → варианты заголовка (пробуются по порядку). Секция заканчивается там,
    где начинается ЛЮБОЙ другой известный заголовок (а не произвольное «слово с двоеточием»).
    """
    text = text or ""
    found: list[tuple[int, int, str]] = []  # (start, content_start, key)
    for key, variants in headers.items():
        for variant in variants:
            m = _header_re(variant).search(text)
            if m:
                found.append((m.start(), m.end(), key))
                break
    found.sort()
    out: dict[str, str] = {}
    for i, (_, content_start, key) in enumerate(found):
        content_end = found[i + 1][0] if i + 1 < len(found) else len(text)
        content = text[content_start:content_end].strip().strip("*").strip()
        # Отбраковка эхо-плейсхолдеров скелета («<заключение для руководителя>» и т.п.).
        if re.fullmatch(r"<[^<>]{0,80}>[\s.]*", content or ""):
            continue
        if content:
            out[key] = content
    return out


def _grounded(text: str, inp: ReasoningInput) -> bool:
    """Grounding-контроль: все проценты вывода обязаны присутствовать во входных данных."""
    used = set(service._PCT_RE.findall(text or ""))
    allowed = service._allowed_pcts(
        inp.judgments_block, inp.risks_block, inp.measures_block,
        inp.metrics_block, inp.history_block, inp.rules_block,
    )
    return not (used - allowed)


def _first_lines(block: str, n: int) -> list[str]:
    return [ln.strip() for ln in (block or "").splitlines() if ln.strip()][:n]


def _cap_block(block: str, limit: int = 10) -> str:
    """Ограничение блока фактов для CPU-инференса; хвост помечается честно, не теряется молча."""
    lines = [ln for ln in (block or "").splitlines() if ln.strip()]
    if len(lines) <= limit:
        return "\n".join(lines)
    return "\n".join(lines[:limit]) + f"\n(+ ещё {len(lines) - limit} строк не показано)"


def _facts_text(inp: ReasoningInput) -> str:
    """Блок фактов для промптов: только переданные данные, с явными отметками отсутствия.

    Сработавшие правила движка (rules_block) идут ПЕРВЫМИ: именно они — повод для объяснения,
    и LLM обязана объяснить их причины/риски/рекомендации (модель не решает, а объясняет вердикт).
    """
    sections = [
        ("Сработавшие правила движка (повод для разбора)", _cap_block(inp.rules_block, 6)),
        ("Профессиональные суждения", _cap_block(inp.judgments_block, 12)),
        ("Риски из базы рисков", _cap_block(inp.risks_block, 8)),
        ("Карточки мер", _cap_block(inp.measures_block, 8)),
        ("Расчётные метрики", _cap_block(inp.metrics_block, 12)),
        ("История прошлых периодов", _cap_block(inp.history_block, 6)),
    ]
    out = []
    for title, block in sections:
        if title.startswith("Сработавшие правила") and not block.strip():
            continue  # нет сработавших правил — не засоряем факты пустой секцией
        out.append(f"{title}:\n{block.strip()}" if block.strip() else f"{title}: {_ABSENT}")
    return "\n".join(out)


def _degenerate(text: str) -> bool:
    """Детект вырождения мелкой модели (зацикленные повторы): низкая доля уникальных слов."""
    words = re.findall(r"\w+", (text or "").lower())
    return len(words) > 30 and len(set(words)) / len(words) < 0.35


def _input_anchors(inp: ReasoningInput) -> set[str]:
    """Содержательные токены входа (≥6 символов) — словарь фактов для проверки якорения."""
    text = " ".join((inp.judgments_block, inp.risks_block, inp.measures_block,
                     inp.metrics_block, inp.system_name)).lower()
    return {w for w in re.findall(r"\w{6,}", text)}


def _anchored(text: str, inp: ReasoningInput) -> bool:
    """Проверка привязки вывода к фактам: текст обязан разделять хотя бы один содержательный
    токен со входными фактами. Отсекает родовой «менеджерский» трёп мелкой модели, никак не
    привязанный к переданным данным (числового grounding для этого недостаточно)."""
    anchors = _input_anchors(inp)
    if not anchors:
        return True  # входы пустые — проверка неприменима
    used = set(re.findall(r"\w{6,}", (text or "").lower()))
    return bool(anchors & used)


def _llm_pass(prompt: str, inp: ReasoningInput, max_tokens: int = 400,
              require_anchor: bool = False, system: str | None = None) -> str | None:
    """LLM-проход с grounding-контролем: недостоверный или выродившийся вывод отбраковывается.

    `system` — системный промпт персоны (prompts.reasoning_system_prompt); None означает
    персону по умолчанию, чтобы прямые вызовы прохода оставались работоспособными.
    """
    if system is None:
        system = reasoning_system_prompt(personas.get(personas.DEFAULT_PERSONA_CODE))
    text = service.complete(prompt, system=system, max_tokens=max_tokens)
    if not text:
        return None
    if not _grounded(text, inp):
        logger.warning("Контроль достоверности: проход содержит числа вне входных данных — отбраковано")
        return None
    if _degenerate(text):
        logger.warning("Контроль достоверности: вырожденный вывод (зацикленные повторы) — отбраковано")
        return None
    if require_anchor and not _anchored(text, inp):
        logger.warning("Контроль достоверности: вывод не привязан к входным фактам (нет якорей) — отбраковано")
        return None
    return text


# ─── Лестница «почему»: разбор ступеней и оформление первопричины (Э2, ТЗ v18) ────────

# Ступень лестницы: «ПОЧЕМУ-3: не выделен ресурс». Терпим к формату мелких моделей
# (markdown-маркеры, пробелы, тире вместо двоеточия, «ПОЧЕМУ 3»).
_WHY_RE = re.compile(
    r"^[ \t#*>\-]*почему[\s\-–—]*(\d{1,2})[ \t*]*[:：.\-–—]+[ \t]*(.+)$",
    flags=re.IGNORECASE | re.MULTILINE,
)
# Признак честной остановки лестницы («данных для следующего «почему» нет»).
_WHY_STOP_RE = re.compile(r"данн\w*\s+(?:для|нет)|нет\s+данн\w*|данные отсутствуют", re.IGNORECASE)


def parse_why_chain(text: str, max_depth: int = 5) -> list[str]:
    """Извлекает ДОКАЗАННЫЕ ступени лестницы «почему» из ответа модели.

    Ступень-заглушка («данных для следующего «почему» нет») лестницу завершает и в цепочку
    НЕ попадает: глубина обязана отражать доказанные ступени, иначе показатель глубины
    поощрял бы модель дописывать пустые уровни. Ступени нумеруются моделью; читаем их по
    возрастанию номера и обрываем на первом разрыве нумерации — так перепутанный порядок
    не превращается в выдуманную глубину.
    """
    found: dict[int, str] = {}
    for m in _WHY_RE.finditer(text or ""):
        n = int(m.group(1))
        body = m.group(2).strip().strip("*").strip()
        if 1 <= n <= max_depth and n not in found and body:
            found[n] = body
    chain: list[str] = []
    for n in range(1, max_depth + 1):
        body = found.get(n)
        if not body:
            break                     # разрыв нумерации — дальше лестницы нет
        if _WHY_STOP_RE.search(body):
            break                     # честная остановка: ступень не доказана
        chain.append(body)
    return chain


def _render_why(chain: list[str], raw: str) -> str:
    """Текст этапа Э2: пронумерованная лестница + вывод об управляемой первопричине.

    Если ступени не распознались (модель ответила сплошным текстом), сохраняем её ответ
    как есть — терять содержательный вывод из-за формата нельзя.
    """
    if not chain:
        return raw.strip()
    lines = [f"Почему {i}: {step}" for i, step in enumerate(chain, start=1)]
    lines.append(f"Управляемая первопричина ({len(chain)}-я ступень): {chain[-1]}")
    if len(chain) < 5:
        lines.append("Дальнейшее углубление невозможно: данных для следующего «почему» нет.")
    return "\n".join(lines)


# ─── Уточняющие вопросы (Э2.5, ТЗ v18 п.7) ────────────────────────────────────────────

# Принцип отбора вопросов. Спрашивать про ОТСУТСТВУЮЩИЕ источники бессмысленно: блок фактов
# и так честно печатает «данные отсутствуют», ответ предопределён, а проход по CPU потрачен.
# Ценность даёт другой вопрос — про СВЯЗИ ВНУТРИ ПЕРЕДАННЫХ данных, которые в них заложены,
# но не выписаны явно: закрывают ли меры найденную причину, противоречат ли суждения друг
# другу, что изменилось к прошлому периоду. Поэтому каждый вопрос имеет предусловие
# наличия своего источника, а пробелы данных отрабатывает матрица достаточности (Э6/E0).
#
# Формат записи: (предикат применимости, текст вопроса).
_REFINEMENT_QUESTIONS: tuple[tuple[str, str], ...] = (
    ("measures", "Закрывают ли перечисленные меры выявленную первопричину, и какая её часть "
                 "остаётся не закрытой?"),
    ("risks", "Какие из перечисленных рисков подтверждаются переданными суждениями, "
              "а какие переданными данными не подтверждены?"),
    ("history", "Что изменилось по сравнению с прошлыми периодами — ухудшение, улучшение "
                "или та же картина?"),
    ("coverage", "Какие подхарактеристики остались неизмеренными и как именно это ограничивает "
                 "вывод?"),
    ("judgments", "Есть ли среди переданных суждений противоречащие друг другу?"),
)


def _questions_for(inp: ReasoningInput, low_coverage: bool, limit: int = 3) -> list[str]:
    """Уточняющие вопросы, применимые к ПЕРЕДАННЫМ данным (не более limit — бюджет CPU-прохода).

    Порядок отражает ценность для разбора: связь мер с причиной важнее поиска противоречий.
    """
    available = {
        "measures": bool(inp.measures_block.strip()),
        "risks": bool(inp.risks_block.strip()),
        "history": bool(inp.history_block.strip()),
        "coverage": low_coverage,
        # Противоречия ищем только когда суждений хотя бы два — иначе противоречить нечему.
        "judgments": len(_first_lines(inp.judgments_block, 999)) >= 2,
    }
    out: list[str] = []
    for key, question in _REFINEMENT_QUESTIONS:
        if available.get(key):
            out.append(question)
        if len(out) >= limit:
            break
    return out


def _answers_are_empty(answers: list[str]) -> bool:
    """True, если модель на все вопросы ответила «данные отсутствуют» (проход бесполезен)."""
    return all(_WHY_STOP_RE.search(a or "") for a in answers) if answers else True


# ─── Детерминированные fallback'и этапов (grounded по построению) ────────────────────

def _fallback_problem(inp: ReasoningInput) -> str:
    chars = sorted({
        ln.split("/")[0].strip()
        for ln in _first_lines(inp.judgments_block, 50) if "/" in ln
    })
    worst = None
    worst_pct = None
    for ln in (inp.metrics_block or "").splitlines():
        m = service._PCT_RE.search(ln)
        if m and (worst_pct is None or int(m.group(1)) < worst_pct):
            worst_pct, worst = int(m.group(1)), ln.strip()
    parts = []
    if chars:
        parts.append("Зоны внимания по суждениям: " + ", ".join(chars[:6]) + ".")
    if worst:
        parts.append(f"Наиболее просевший показатель: «{worst}».")
    return " ".join(parts) or f"По ИС «{inp.system_name}» конкретизирующие данные о проблеме {_ABSENT}."


def _fallback_root_cause(inp: ReasoningInput) -> str:
    risk_lines = _first_lines(inp.risks_block, 2)
    if risk_lines:
        return ("Кандидаты первопричины по базе рисков: " + "; ".join(risk_lines)
                + ". Данных для следующего «почему» нет.")
    return ("Первопричина по переданным данным не установлена — данных для цепочки «почему» "
            "недостаточно (нужны суждения с причинами или риски из базы).")


def _fallback_lens_view(code: str, inp: ReasoningInput) -> str:
    j = _first_lines(inp.judgments_block, 1)
    r = _first_lines(inp.risks_block, 1)
    m = _first_lines(inp.measures_block, 1)
    if code == "CIO":
        n = len(_first_lines(inp.judgments_block, 999))
        return (f"По ИС «{inp.system_name}» за {inp.period_label} зафиксировано {n} суждений; "
                "стратегическая оценка требует решения ЛПР по просевшим характеристикам."
                if n else f"Данных для стратегической оценки {_ABSENT}.")
    if code == "QUALITY":
        return f"Ключевое суждение: {j[0]}" if j else f"Суждения по подхарактеристикам {_ABSENT}."
    if code == "RISK":
        return f"Активируемый риск из базы: {r[0]}" if r else f"Связанные риски в базе {_ABSENT}."
    if code == "SECURITY":
        sec = [ln for ln in _first_lines(inp.judgments_block, 999)
               if "защищ" in ln.lower() or "безопас" in ln.lower()]
        if sec:
            return f"Сигнал по защищённости: {sec[0]}"
        if m:
            return f"Прямых сигналов по защищённости нет; мера на контроле: {m[0]}"
        return f"Прямых сигналов по защищённости во входных данных нет ({_ABSENT})."
    return _ABSENT


def _fallback_measures(inp: ReasoningInput) -> str:
    lines = []
    for ln in _first_lines(inp.measures_block, 3):
        lines.append(f"- Мера (из карточек мер): {ln}")
    for ln in _first_lines(inp.risks_block, 3):
        if ":" in ln:
            title, mitigation = ln.lstrip("- ").split(":", 1)
            if mitigation.strip() and mitigation.strip() != "—":
                lines.append(f"- Мера (минимизация из базы рисков): {mitigation.strip()} → закрывает риск «{title.strip()}»")
    return "\n".join(lines) or "Меры во входных данных отсутствуют — синтез мер не выполнен."


def _confidence(inp: ReasoningInput, absent: list[str], fell_back: int) -> str:
    """Уверенность конвейера: высокая — все источники и все этапы от LLM; средняя — есть хотя бы
    один первичный источник контура (суждения ИЛИ карточки мер); иначе низкая.

    Вынесено в функцию, потому что считается ДВАЖДЫ: предварительно — для матрицы доверия
    перед синтезом, и окончательно — на этапе саморефлексии. Формула обязана быть одной.
    """
    if not absent and not fell_back:
        return "высокая"
    return "средняя" if (inp.judgments_block.strip() or inp.measures_block.strip()) else "низкая"


# ─── Конвейер ─────────────────────────────────────────────────────────────────────────

def run_reasoning(inp: ReasoningInput, use_llm: bool = True,
                  lens_codes: tuple[str, ...] | None = None,
                  persona: Persona | str | None = None) -> ReasoningTrace:
    """Прогон конвейера Э0–Э7 под ПЕРСОНУ адресата. Всегда возвращает полную трассу.

    persona    — Persona, её код или None (персона по умолчанию). Задаёт системный промпт,
                 линзы, глубину лестницы «почему», бюджет ответа и чек-лист принципов.
    lens_codes — явный набор линз; None → набор персоны. Минимум 3 точки зрения (BL-005).
    """
    pers = persona if isinstance(persona, Persona) else personas.get(persona)
    if lens_codes is None:
        lens_codes = pers.lens_codes
    if len(lens_codes) < 3:
        raise ValueError("Многоаспектный анализ требует минимум 3 ролевые точки зрения")
    sys_prompt = reasoning_system_prompt(pers)
    trace = ReasoningTrace(input=inp, persona=pers.code)
    facts = _facts_text(inp)
    # Обогащение промптов доменными знаниями: определения просевших характеристик из
    # глоссария ISO 25010 (knowledge.py). Идёт ТОЛЬКО в промпты LLM (чтобы «мясо» рассуждения
    # было содержательным при скудных данных), но НЕ в отображаемый блок фактов E0 —
    # там остаётся чистая инвентаризация переданного. Чисел глоссарий не добавляет.
    glossary = relevant_terms(
        inp.judgments_block, inp.risks_block, inp.measures_block,
        inp.metrics_block, inp.system_name,
    )
    facts_llm = f"{facts}\n\n{glossary}" if glossary else facts
    absent = [title for title, block in [
        ("суждения", inp.judgments_block), ("риски", inp.risks_block),
        ("карточки мер", inp.measures_block), ("метрики", inp.metrics_block),
        ("история", inp.history_block),
    ] if not block.strip()]

    # Э0 — Факты входа: инвентаризация фактов (детерминированно по построению).
    trace.stages.append(StageResult("E0", _STAGE_TITLES["E0"], facts))

    # Э1+Э2 — проблема и первопричина (LLM-проход 1, секции ПРОБЛЕМА/ПЕРВОПРИЧИНА).
    # require_anchor: проблема/первопричина обязаны ссылаться на факты входа,
    # иначе E7 унаследует «менеджерский» трёп, не привязанный к данным.
    analysis = _llm_pass(
        REASONING_PASS_ANALYSIS.format(system_name=inp.system_name, period_label=inp.period_label,
                                       facts=facts_llm, why_depth=pers.why_depth),
        inp, max_tokens=120 + 40 * pers.why_depth, require_anchor=True, system=sys_prompt,
    ) if use_llm else None
    analysis_sections = _split_sections(analysis or "", {
        "problem": ["ПРОБЛЕМА"], "root": ["ПЕРВОПРИЧИНА"],
    })
    problem = analysis_sections.get("problem")
    root = analysis_sections.get("root")
    # Лестница «почему»: считаем ДОКАЗАННЫЕ ступени и переоформляем этап в читаемый вид.
    trace.why_chain = parse_why_chain(root or "", max_depth=pers.why_depth)
    trace.stages.append(StageResult(
        "E1", _STAGE_TITLES["E1"], problem or _fallback_problem(inp),
        used_llm=bool(problem), fell_back=not problem,
    ))
    trace.stages.append(StageResult(
        "E2", _STAGE_TITLES["E2"],
        _render_why(trace.why_chain, root) if root else _fallback_root_cause(inp),
        used_llm=bool(root), fell_back=not root,
    ))

    # Э2.5 — Уточняющие вопросы: доуточнение контекста (ТЗ v18 п.7).
    # Вопросы формируются ДЕТЕРМИНИРОВАННО из состава ПЕРЕДАННЫХ данных (см. _questions_for):
    # спрашиваем о связях внутри имеющегося, а не об отсутствующем — ответ на второе предрешён
    # блоком фактов и лишь тратит проход. Матрица достаточности данных считается здесь же, но
    # её задача другая: она идёт в блок решений и в саморефлексию.
    data_d = decisions.data_sufficiency(
        inp.measured_subs, inp.total_subs,
        has_judgments=bool(inp.judgments_block.strip()),
        has_risks=bool(inp.risks_block.strip()),
        has_measures=bool(inp.measures_block.strip()),
        has_history=bool(inp.history_block.strip()),
        has_criticality=bool(inp.criticality.strip()),
    )
    low_coverage = bool(inp.total_subs) and (inp.measured_subs / inp.total_subs) < decisions.COVERAGE_OK
    questions = _questions_for(inp, low_coverage)
    qa_text = None
    if use_llm and questions:
        numbered = "\n".join(f"{i}. {q}" for i, q in enumerate(questions, start=1))
        skeleton = "\n".join(f"ОТВЕТ-{i}: <ответ или «данные отсутствуют»>"
                             for i in range(1, len(questions) + 1))
        qa_text = _llm_pass(
            REASONING_PASS_QA.format(system_name=inp.system_name, period_label=inp.period_label,
                                     facts=facts_llm, questions=numbered, answers_skeleton=skeleton),
            inp, max_tokens=60 * len(questions), system=sys_prompt,
        )
    qa_sections = _split_sections(qa_text or "", {
        str(i): [f"ОТВЕТ-{i}", f"ОТВЕТ {i}"] for i in range(1, len(questions) + 1)
    })
    for i, question in enumerate(questions, start=1):
        answer = qa_sections.get(str(i)) or _ABSENT
        trace.questions.append(QuestionAnswer(
            number=i, question=question, answer=answer,
            resolved=not bool(_WHY_STOP_RE.search(answer)),
        ))
    if trace.questions:
        qa_content = "\n".join(f"{q.number}. {q.question}\n   → {q.answer}" for q in trace.questions)
        resolved_n = sum(1 for q in trace.questions if q.resolved)
        qa_content += (f"\nУточнено по переданным данным: {resolved_n} из {len(trace.questions)}; "
                       "остальное данными не подтверждается.")
    else:
        qa_content = ("Переданных данных недостаточно для уточняющих вопросов: связывать нечего "
                      "(нет мер, рисков, истории и нескольких суждений).")
    qa_used_llm = any(q.resolved for q in trace.questions)
    trace.stages.append(StageResult(
        "E2Q", _STAGE_TITLES["E2Q"], qa_content,
        used_llm=qa_used_llm,
        # Отсутствие пробелов — не откат: этап отработал штатно, спрашивать было нечего.
        fell_back=bool(trace.questions) and not qa_used_llm,
    ))

    # Э3 — Ролевые точки зрения: экспертные линзы (LLM-проход 2, секция на линзу).
    lens_tasks = "\n".join(
        f"ЛИНЗА {code} — {REASONING_LENSES[code][0]}: {REASONING_LENSES[code][1]}"
        for code in lens_codes
    )
    lens_skeleton = "\n".join(f"ЛИНЗА {code}: <взгляд линзы>" for code in lens_codes)
    lens_text = _llm_pass(
        REASONING_PASS_LENSES.format(system_name=inp.system_name, period_label=inp.period_label,
                                     facts=facts_llm, lens_tasks=lens_tasks, lens_skeleton=lens_skeleton),
        inp, max_tokens=60 * len(lens_codes), system=sys_prompt,
    ) if use_llm else None
    lens_sections = _split_sections(lens_text or "", {
        # варианты заголовка: «ЛИНЗА CIO:», просто «CIO:», русское название линзы
        code: [f"ЛИНЗА {code}", code, REASONING_LENSES[code][0]] for code in lens_codes
    })
    for code in lens_codes:
        title, question, iso_ref = REASONING_LENSES[code]
        view = lens_sections.get(code)
        trace.lenses.append(LensView(
            code=code, title=title, question=question, iso_ref=iso_ref,
            view=view or _fallback_lens_view(code, inp), used_llm=bool(view),
        ))
    lens_summary = "\n".join(f"- {lens.title} ({lens.iso_ref}): {lens.view}" for lens in trace.lenses)
    trace.stages.append(StageResult(
        "E3", _STAGE_TITLES["E3"], lens_summary,
        used_llm=any(lens.used_llm for lens in trace.lenses),
        fell_back=not any(lens.used_llm for lens in trace.lenses),
    ))

    # Э4 — Контроль достоверности: уже применён к каждому проходу (_llm_pass); фиксируем итог.
    rejected = [s.code for s in trace.stages if s.fell_back]
    gate_note = ("Вердикт вынесен детерминированным движком правил (см. факты входа); LLM его "
                 "ОБЪЯСНЯЕТ, а не переопределяет. " if inp.rules_block.strip() else "")
    trace.stages.append(StageResult(
        "E4", _STAGE_TITLES["E4"],
        (gate_note
         + "Grounding-контроль пройден: числа этапов — только из входных данных. "
         + (f"Этапы на детерминированном fallback: {', '.join(rejected)}." if rejected
            else "Все этапы приняты от LLM.")),
    ))

    # Э5+Э7 — синтез мер и заключение (LLM-проход 3, секции МЕРЫ/ЗАКЛЮЧЕНИЕ).
    prior = (
        f"Проблема: {trace.stage('E1').content}\n"
        f"Первопричина: {trace.stage('E2').content}\n"
        f"Линзы:\n{lens_summary}"
    )
    # Правило синтеза: если ни карточек мер, ни минимизаций рисков не передано —
    # мерам просто не из чего синтезироваться; LLM не спрашиваем (любой ответ был бы выдумкой),
    # E5 честно уходит в детерминированный fallback, а LLM-проход тратится только на заключение.
    has_measure_sources = bool(inp.measures_block.strip() or inp.risks_block.strip())
    # Матрицы решений: уровень решения и доверие к выводу считаются ДО синтеза, чтобы модель
    # получила их как заданное и объяснила, а не «переоткрыла» своими словами.
    triage_d = decisions.triage(inp.severity, inp.criticality)
    fell_back_so_far = sum(1 for s in trace.stages if s.fell_back)
    trust_d = decisions.trust(_confidence(inp, absent, fell_back_so_far),
                              fell_back_so_far, len(trace.stages))
    decisions_block = decisions.as_block(triage_d, trust_d, data_d)
    checklist = checklist_for(pers)
    if use_llm and has_measure_sources:
        synthesis = _llm_pass(
            REASONING_PASS_SYNTHESIS.format(system_name=inp.system_name, period_label=inp.period_label,
                                            facts=facts_llm, prior=prior,
                                            decisions=decisions_block, checklist=checklist),
            inp, max_tokens=pers.max_tokens, system=sys_prompt,
        )
    elif use_llm:
        synthesis = _llm_pass(
            REASONING_PASS_CONCLUSION_ONLY.format(system_name=inp.system_name, period_label=inp.period_label,
                                                  facts=facts_llm, prior=prior,
                                                  decisions=decisions_block, checklist=checklist),
            inp, max_tokens=max(160, pers.max_tokens - 80), system=sys_prompt,
        )
    else:
        synthesis = None
    synth_sections = _split_sections(synthesis or "", {
        "measures": ["МЕРЫ"], "conclusion": ["ЗАКЛЮЧЕНИЕ"],
    })
    measures = synth_sections.get("measures") if has_measure_sources else None
    conclusion_llm = synth_sections.get("conclusion")
    trace.stages.append(StageResult(
        "E5", _STAGE_TITLES["E5"], measures or _fallback_measures(inp),
        used_llm=bool(measures), fell_back=not measures,
    ))

    # Э6 — Саморефлексия (детерминированно: полнота данных + fallback-этапы).
    fell_back_now = [s.code for s in trace.stages if s.fell_back]
    trace.confidence = _confidence(inp, absent, len(fell_back_now))
    # Матрица доверия пересчитывается по ОКОНЧАТЕЛЬНОМУ составу откатов: до синтеза этап E5
    # ещё не был известен, а именно он часто и уходит в откат.
    trust_d = decisions.trust(trace.confidence, len(fell_back_now), len(trace.stages))
    hansei = (
        (f"Не переданы: {', '.join(absent)} — выводы по этим аспектам ограничены. " if absent else
         "Все источники входных данных переданы. ")
        + (f"Этапы {', '.join(fell_back_now)} сформированы детерминированно (LLM-вывод недоступен/отбракован). "
           if fell_back_now else "Все этапы приняты от LLM. ")
        + f"Уверенность: {trace.confidence}. "
        + f"Глубина разбора причин: {trace.why_depth} ступ. "
        + f"Доверие к выводу: {trust_d.level} — {trust_d.policy}."
    )
    trace.stages.append(StageResult("E6", _STAGE_TITLES["E6"], hansei))

    # Э7 — Заключение для руководителя (ЛПР). Структура блоков соответствует схеме
    # «Rule Engine → LLM»: Объяснение · Причины · Риски · Рекомендации. Движок выносит вердикт,
    # LLM его объясняет; блоки собираются из трассы (аудируемость), LLM-текст — в «Рекомендациях».
    applied = ", ".join(lens.title for lens in trace.lenses)
    risks_out = "; ".join(_first_lines(inp.risks_block, 3)) or _ABSENT
    fired = _first_lines(inp.rules_block, 4)
    explanation = ("Сработавшие правила движка: " + "; ".join(fired)
                   if fired else f"Рассмотренные аспекты: {applied}.")
    conclusion = (
        f"Объяснение: {explanation}\n"
        f"Причины (первопричина): {trace.stage('E2').content}\n"
        f"Риски (база рисков): {risks_out}\n"
        f"Решение (матрица): уровень — {triage_d.tier}; адресат — {triage_d.addressee}; "
        f"ориентировочный срок — {triage_d.sla_days} дн.; {triage_d.action}.\n"
        f"Рекомендации: "
        + (conclusion_llm if conclusion_llm else
           "вынести первопричину на решение топ-менеджмента; закрепить меры с ответственными и сроками "
           "в плане обеспечения качества. (Сформировано строго по входным данным.)")
        + f"\nПредлагаемые меры:\n{trace.stage('E5').content}"
        + f"\nУверенность и оговорки: {hansei}"
    )
    trace.conclusion = conclusion
    trace.stages.append(StageResult(
        "E7", _STAGE_TITLES["E7"], conclusion,
        used_llm=bool(conclusion_llm), fell_back=not conclusion_llm,
    ))
    trace.decisions = {
        "triage": triage_d.to_dict(),
        "trust": trust_d.to_dict(),
        "data_sufficiency": data_d.to_dict(),
    }
    # Чек-лист управленческих принципов применяется к резюме той персоны, которая его требует
    # (топ-менеджер). Это признак отражения темы в тексте, а не оценка соблюдения принципа.
    if pers.apply_principles:
        trace.principles_audit = principles.audit(conclusion)
        trace.principles_audit["required_coverage"] = principles.prompt_coverage(conclusion)
    trace.llm_used = any(s.used_llm for s in trace.stages)
    return trace


_cache: dict[int, dict] = {}


def _extract_chars(judgments_block: str, metrics_block: str) -> list[str]:
    """Характеристики качества, упомянутые во входе (для ключей памяти «мозга» и recall)."""
    chars: set[str] = set()
    for ln in (judgments_block or "").splitlines():
        if "/" in ln:
            chars.add(ln.split("/")[0].strip())
    for ln in (metrics_block or "").splitlines():
        if "|" in ln:
            chars.add(ln.split("|")[0].strip())
    return sorted(c for c in chars if c)


def generate_reasoned_conclusion(system_name: str, period_label: str, judgments_block: str,
                                 risks_block: str = "", history_block: str = "",
                                 measures_block: str = "", metrics_block: str = "",
                                 rules_block: str = "", severity: str = "none",
                                 criticality: str = "", measured_subs: int = 0,
                                 total_subs: int = 0, persona: str | None = None) -> dict:
    """Высокоуровневый вход конвейера (аналог generate_judgment_conclusion, но с трассой).

    Самообучение через «резервный мозг» (переносимо между моделями): перед прогоном история
    обогащается памятью прошлых заключений (brain.recall), после — заключение запоминается
    (brain.remember). Возвращает conclusion/trace/confidence/llm/fingerprint + persona и
    decisions (решения матриц); кэшируется по входам, включая персону: у разных адресатов
    заключения разные, и склеивать их в одной ячейке кэша нельзя.
    """
    pers = personas.get(persona)
    key = hash((system_name, period_label, judgments_block, risks_block,
                history_block, measures_block, metrics_block, rules_block,
                severity, criticality, measured_subs, total_subs, pers.code))
    if key in _cache:
        return _cache[key]

    chars = _extract_chars(judgments_block, metrics_block)
    fp = brain.fingerprint(system_name, period_label, judgments_block, measures_block)
    # RAG: подмешиваем к истории релевантную память «мозга» (живёт вне модели → переносима).
    try:
        recalled = brain.recall(system_name, chars)
    except Exception:  # noqa: BLE001
        recalled = ""
    merged_history = "\n".join(h for h in (history_block, recalled) if h.strip())

    trace = run_reasoning(ReasoningInput(
        system_name=system_name, period_label=period_label,
        judgments_block=judgments_block, risks_block=risks_block,
        measures_block=measures_block, metrics_block=metrics_block,
        history_block=merged_history, rules_block=rules_block,
        severity=severity, criticality=criticality,
        measured_subs=measured_subs, total_subs=total_subs,
    ), persona=pers)

    # Запоминаем заключение в «мозг» (вне файла модели) — переживёт переключение модели.
    try:
        brain.remember({
            "fingerprint": fp,
            "system": system_name,
            "period": period_label,
            "chars": chars,
            "problem": (trace.stage("E1").content if trace.stage("E1") else ""),
            "root_cause": (trace.stage("E2").content if trace.stage("E2") else ""),
            "measures": (trace.stage("E5").content if trace.stage("E5") else ""),
            "risks": risks_block[:500],
            "confidence": trace.confidence,
            "model_name": (service._profile.name if service._profile else ""),
            # Персона и глубина разбора — часть паспорта заключения: при смене модели новая
            # модель должна видеть, для кого и насколько глубоко разбирали прошлый раз.
            "persona": trace.persona,
            "why_depth": trace.why_depth,
        })
    except Exception:  # noqa: BLE001
        logger.debug("brain.remember пропущен", exc_info=True)

    result = {
        "conclusion": trace.conclusion,
        "trace": trace.to_dict(),
        "confidence": trace.confidence,
        "llm": trace.llm_used,
        "fingerprint": fp,
        "persona": trace.persona,
        "decisions": trace.decisions,
    }
    _cache[key] = result
    return result
