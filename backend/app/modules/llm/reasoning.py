"""
reasoning.py — конвейер многоаспектного рассуждения LLM (BL-005, ТЗ v13, домен llm).

Реализация манифеста «Дао Тойота × IT × ISO» (Obsidian: AI/АСОК_ИС/09_Манифест_LLM_Дао-Тойота.md):
прежде чем вынести заключение руководителю (ЛПР), модель проходит этапы

    Э0 Генти Генбуцу  — инвентаризация фактов входа (только переданное; чего нет — «отсутствует»)
    Э1 Проблема       — что именно просело
    Э2 5 Почему       — первопричина, а не симптом
    Э3 Немаваси       — ролевые линзы (≥3 точек зрения: CIO, качество, риски, ИБ)
    Э4 Дзидока        — встроенное качество: grounding-проверка чисел каждого этапа (андон)
    Э5 Кайдзен        — синтез мер (мера → закрываемый риск), только из переданных мер/минимизаций
    Э6 Хансей         — саморефлексия: чего не хватает, где fallback, уверенность
    Э7 Заключение ЛПР — контракт из 6 блоков, ТОЛЬКО после Э0–Э6

Инженерные принципы (сохранены из service.py):
  • grounding: проценты в выводе каждого этапа обязаны присутствовать во входе, иначе этап
    заменяется детерминированным fallback (Дзидока = «остановись и почини», а не «пропусти дефект»);
  • деградация: без модели/при ошибке конвейер полностью детерминирован и всегда даёт трассу
    и заключение (честное, без выдумок);
  • экономия CPU: 3 LLM-прохода (Э1+Э2, Э3, Э5+Э7) с секционными маркерами вместо 8.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field

from app.modules.llm import service
from app.modules.llm.prompts import (
    REASONING_LENSES,
    REASONING_PASS_ANALYSIS,
    REASONING_PASS_CONCLUSION_ONLY,
    REASONING_PASS_LENSES,
    REASONING_PASS_SYNTHESIS,
    REASONING_SYSTEM_PROMPT,
)

logger = logging.getLogger(__name__)

# Порядок и названия этапов конвейера (код, заголовок).
STAGES: list[tuple[str, str]] = [
    ("E0", "Генти Генбуцу — факты входа"),
    ("E1", "Постановка проблемы"),
    ("E2", "5 Почему — первопричина"),
    ("E3", "Немаваси — ролевые линзы"),
    ("E4", "Дзидока — контроль качества этапов"),
    ("E5", "Кайдзен — синтез мер"),
    ("E6", "Хансей — саморефлексия"),
    ("E7", "Заключение ЛПР"),
]

_STAGE_TITLES = dict(STAGES)


@dataclass(frozen=True)
class ReasoningInput:
    """Входы конвейера — три источника контура + метрики и история (RAG)."""
    system_name: str
    period_label: str
    judgments_block: str = ""   # профессиональные суждения (характеристика / подхар.: текст)
    risks_block: str = ""       # риски из базы ("- титул: мера минимизации")
    measures_block: str = ""    # карточки мер (сводка), может отсутствовать
    metrics_block: str = ""     # расчётные метрики ("характеристика | метрика | %")
    history_block: str = ""     # суждения/выводы прошлых периодов (преемственность)


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
    grounded: bool = True       # True: прошёл Дзидока-проверку ИЛИ детерминирован по построению
    fell_back: bool = False     # True: LLM-вывод отбракован/недоступен → детерминированный текст


@dataclass
class ReasoningTrace:
    """Аудируемая трасса конвейера: этапы, линзы, заключение, уверенность."""
    input: ReasoningInput
    stages: list[StageResult] = field(default_factory=list)
    lenses: list[LensView] = field(default_factory=list)
    conclusion: str = ""
    confidence: str = "низкая"          # низкая | средняя | высокая (детерминированно из полноты данных)
    llm_used: bool = False              # хотя бы один этап принят от LLM

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
        }

    def as_training_block(self) -> str:
        """Компактная трасса Э1–Э6 для SFT-корпуса (уровень C, LLM_TRAINING §9)."""
        parts: list[str] = []
        for code in ("E1", "E2"):
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
    """Дзидока: все проценты вывода обязаны присутствовать во входных данных."""
    used = set(service._PCT_RE.findall(text or ""))
    allowed = service._allowed_pcts(
        inp.judgments_block, inp.risks_block, inp.measures_block,
        inp.metrics_block, inp.history_block,
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
    """Блок фактов для промптов: только переданные данные, с явными отметками отсутствия."""
    sections = [
        ("Профессиональные суждения", _cap_block(inp.judgments_block, 12)),
        ("Риски из базы рисков", _cap_block(inp.risks_block, 8)),
        ("Карточки мер", _cap_block(inp.measures_block, 8)),
        ("Расчётные метрики", _cap_block(inp.metrics_block, 12)),
        ("История прошлых периодов", _cap_block(inp.history_block, 6)),
    ]
    out = []
    for title, block in sections:
        out.append(f"{title}:\n{block.strip()}" if block.strip() else f"{title}: {_ABSENT}")
    return "\n".join(out)


def _degenerate(text: str) -> bool:
    """Детект вырождения мелкой модели (зацикленные повторы): низкая доля уникальных слов."""
    words = re.findall(r"\w+", (text or "").lower())
    return len(words) > 30 and len(set(words)) / len(words) < 0.35


def _llm_pass(prompt: str, inp: ReasoningInput, max_tokens: int = 400) -> str | None:
    """LLM-проход с Дзидока-контролем: недостоверный или выродившийся вывод отбраковывается."""
    text = service.complete(prompt, system=REASONING_SYSTEM_PROMPT, max_tokens=max_tokens)
    if not text:
        return None
    if not _grounded(text, inp):
        logger.warning("Дзидока (андон): проход содержит числа вне входных данных — отбраковано")
        return None
    if _degenerate(text):
        logger.warning("Дзидока (андон): вырожденный вывод (зацикленные повторы) — отбраковано")
        return None
    return text


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


# ─── Конвейер ─────────────────────────────────────────────────────────────────────────

def run_reasoning(inp: ReasoningInput, use_llm: bool = True,
                  lens_codes: tuple[str, ...] = ("CIO", "QUALITY", "RISK", "SECURITY")) -> ReasoningTrace:
    """Прогон конвейера Э0–Э7. Всегда возвращает полную трассу (с LLM или детерминированно)."""
    if len(lens_codes) < 3:
        raise ValueError("Немаваси требует минимум 3 ролевые линзы (манифест, часть III)")
    trace = ReasoningTrace(input=inp)
    facts = _facts_text(inp)
    absent = [title for title, block in [
        ("суждения", inp.judgments_block), ("риски", inp.risks_block),
        ("карточки мер", inp.measures_block), ("метрики", inp.metrics_block),
        ("история", inp.history_block),
    ] if not block.strip()]

    # Э0 — Генти Генбуцу: инвентаризация фактов (детерминированно по построению).
    trace.stages.append(StageResult("E0", _STAGE_TITLES["E0"], facts))

    # Э1+Э2 — проблема и первопричина (LLM-проход 1, секции ПРОБЛЕМА/ПЕРВОПРИЧИНА).
    analysis = _llm_pass(
        REASONING_PASS_ANALYSIS.format(system_name=inp.system_name, period_label=inp.period_label, facts=facts),
        inp, max_tokens=200,
    ) if use_llm else None
    analysis_sections = _split_sections(analysis or "", {
        "problem": ["ПРОБЛЕМА"], "root": ["ПЕРВОПРИЧИНА"],
    })
    problem = analysis_sections.get("problem")
    root = analysis_sections.get("root")
    trace.stages.append(StageResult(
        "E1", _STAGE_TITLES["E1"], problem or _fallback_problem(inp),
        used_llm=bool(problem), fell_back=not problem,
    ))
    trace.stages.append(StageResult(
        "E2", _STAGE_TITLES["E2"], root or _fallback_root_cause(inp),
        used_llm=bool(root), fell_back=not root,
    ))

    # Э3 — Немаваси: ролевые линзы (LLM-проход 2, секция на линзу).
    lens_tasks = "\n".join(
        f"ЛИНЗА {code} — {REASONING_LENSES[code][0]}: {REASONING_LENSES[code][1]}"
        for code in lens_codes
    )
    lens_skeleton = "\n".join(f"ЛИНЗА {code}: <взгляд линзы>" for code in lens_codes)
    lens_text = _llm_pass(
        REASONING_PASS_LENSES.format(system_name=inp.system_name, period_label=inp.period_label,
                                     facts=facts, lens_tasks=lens_tasks, lens_skeleton=lens_skeleton),
        inp, max_tokens=60 * len(lens_codes),
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

    # Э4 — Дзидока: контроль уже применён к каждому проходу (_llm_pass); фиксируем итог.
    rejected = [s.code for s in trace.stages if s.fell_back]
    trace.stages.append(StageResult(
        "E4", _STAGE_TITLES["E4"],
        ("Grounding-контроль пройден: числа этапов — только из входных данных. "
         + (f"Этапы на детерминированном fallback: {', '.join(rejected)}." if rejected
            else "Все этапы приняты от LLM.")),
    ))

    # Э5+Э7 — синтез мер и заключение (LLM-проход 3, секции МЕРЫ/ЗАКЛЮЧЕНИЕ).
    prior = (
        f"Проблема: {trace.stage('E1').content}\n"
        f"Первопричина: {trace.stage('E2').content}\n"
        f"Линзы:\n{lens_summary}"
    )
    # Дзидока-правило синтеза: если ни карточек мер, ни минимизаций рисков не передано —
    # мерам просто не из чего синтезироваться; LLM не спрашиваем (любой ответ был бы выдумкой),
    # E5 честно уходит в детерминированный fallback, а LLM-проход тратится только на заключение.
    has_measure_sources = bool(inp.measures_block.strip() or inp.risks_block.strip())
    if use_llm and has_measure_sources:
        synthesis = _llm_pass(
            REASONING_PASS_SYNTHESIS.format(system_name=inp.system_name, period_label=inp.period_label,
                                            facts=facts, prior=prior),
            inp, max_tokens=300,
        )
    elif use_llm:
        synthesis = _llm_pass(
            REASONING_PASS_CONCLUSION_ONLY.format(system_name=inp.system_name, period_label=inp.period_label,
                                                  facts=facts, prior=prior),
            inp, max_tokens=220,
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

    # Э6 — Хансей: саморефлексия (детерминированно: полнота данных + fallback-этапы).
    fell_back_now = [s.code for s in trace.stages if s.fell_back]
    trace.confidence = ("высокая" if not absent and not fell_back_now
                        else "средняя" if inp.judgments_block.strip() else "низкая")
    hansei = (
        (f"Не переданы: {', '.join(absent)} — выводы по этим аспектам ограничены. " if absent else
         "Все источники входных данных переданы. ")
        + (f"Этапы {', '.join(fell_back_now)} сформированы детерминированно (LLM-вывод недоступен/отбракован). "
           if fell_back_now else "Все этапы приняты от LLM. ")
        + f"Уверенность: {trace.confidence}."
    )
    trace.stages.append(StageResult("E6", _STAGE_TITLES["E6"], hansei))

    # Э7 — Заключение ЛПР: контракт из 6 блоков (манифест, часть V). LLM-текст — как «общий
    # вывод» внутри контракта; остальные блоки собираются из трассы (аудируемость).
    applied = ", ".join(lens.title for lens in trace.lenses)
    risks_out = "; ".join(_first_lines(inp.risks_block, 3)) or _ABSENT
    conclusion = (
        f"Рассмотренные аспекты (Немаваси): {applied}.\n"
        f"Первопричина (5 Почему): {trace.stage('E2').content}\n"
        f"Активируемые риски (база рисков): {risks_out}\n"
        f"Предлагаемые меры (Кайдзен):\n{trace.stage('E5').content}\n"
        f"Рекомендация ЛПР: "
        + (conclusion_llm if conclusion_llm else
           "вынести первопричину на решение топ-менеджмента; закрепить меры с ответственными и сроками "
           "в плане обеспечения качества. (Сформировано строго по входным данным.)")
        + f"\nУверенность и оговорки (Хансей): {hansei}"
    )
    trace.conclusion = conclusion
    trace.stages.append(StageResult(
        "E7", _STAGE_TITLES["E7"], conclusion,
        used_llm=bool(conclusion_llm), fell_back=not conclusion_llm,
    ))
    trace.llm_used = any(s.used_llm for s in trace.stages)
    return trace


_cache: dict[int, dict] = {}


def generate_reasoned_conclusion(system_name: str, period_label: str, judgments_block: str,
                                 risks_block: str = "", history_block: str = "",
                                 measures_block: str = "", metrics_block: str = "") -> dict:
    """Высокоуровневый вход конвейера (аналог generate_judgment_conclusion, но с трассой).

    Возвращает {"conclusion", "trace", "confidence", "llm"}; кэшируется по входам.
    """
    key = hash((system_name, period_label, judgments_block, risks_block,
                history_block, measures_block, metrics_block))
    if key in _cache:
        return _cache[key]
    trace = run_reasoning(ReasoningInput(
        system_name=system_name, period_label=period_label,
        judgments_block=judgments_block, risks_block=risks_block,
        measures_block=measures_block, metrics_block=metrics_block,
        history_block=history_block,
    ))
    result = {
        "conclusion": trace.conclusion,
        "trace": trace.to_dict(),
        "confidence": trace.confidence,
        "llm": trace.llm_used,
    }
    _cache[key] = result
    return result
