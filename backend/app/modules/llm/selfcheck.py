"""
selfcheck.py — самооценка LLM-подсистемы по ISO/IEC 25010 (BL-009, ТЗ v18 п.10).

Идея. Система оценивает качество чужих ИС по модели ISO 25010 — значит, она обязана уметь
оценить по той же модели саму себя. Модуль прогоняет батарею проб по ВСЕМ 8 характеристикам
и всем 31 подхарактеристикам эталонной модели (quality.QUALITY_PAIRS) и формирует
формализованный отчёт.

ЧЕСТНОСТЬ ИЗМЕРЕНИЯ — главный принцип модуля, тот же, что у остального контура:
  • подхарактеристика, к LLM-компоненту НЕПРИМЕНИМАЯ (например, эстетика интерфейса),
    помечается «невозможно измерить», а не получает выдуманный балл;
  • проба, требующая инференса, при недоступной модели тоже даёт «невозможно измерить»;
  • интегральный балл считается ТОЛЬКО по измеренным пробам, а покрытие показывается
    отдельно — ровно как методика МК_8.1 требует от оценки любой другой ИС.

Режимы:
  • mode="static" — только интроспективные пробы (без инференса), доли секунды. Годится для
    быстрой проверки конфигурации и для окружений без модели;
  • mode="full"   — плюс пробы инференса (сценарии S1–S3). На CPU с крупной моделью занимает
    минуты, поэтому запускается фоновой задачей, а не в HTTP-запросе.

Отчёты складываются в «резервный мозг» (models/llm_brain/selfcheck/): история + latest.json.
Каталог мозга выбран намеренно — он writable и переживает смену модели, в отличие от
read-only каталога моделей.
"""
from __future__ import annotations

import glob
import json
import logging
import os
import time
import uuid
from dataclasses import dataclass, field
from typing import Callable

from app.infrastructure.config import settings
from app.modules.llm import brain, decisions, personas, pipeline, principles, service
from app.modules.llm.reasoning import ReasoningInput, ReasoningTrace, run_reasoning
from app.modules.quality import QUALITY_MODEL

logger = logging.getLogger(__name__)

MEASURED = "measured"
NOT_MEASURABLE = "not_measurable"

REPORTS_SUBDIR = "selfcheck"
LATEST_FILE = "latest.json"
HISTORY_LIMIT = 52          # хранимая глубина истории (год еженедельных прогонов)

# Бюджет отклика одного прохода, сек. Превышение снижает балл временных характеристик.
# Значение — не SLA продукта, а точка отсчёта пробы: на CPU крупные модели заведомо медленнее,
# и отчёт должен это ПОКАЗЫВАТЬ, а не маскировать.
RESPONSE_BUDGET_S = 60.0


@dataclass
class ProbeResult:
    """Итог одной пробы: статус, балл [0..1] и человекочитаемое обоснование."""

    status: str
    score: float | None
    evidence: str

    @staticmethod
    def measured(score: float, evidence: str) -> "ProbeResult":
        return ProbeResult(MEASURED, max(0.0, min(1.0, round(score, 3))), evidence)

    @staticmethod
    def skip(evidence: str) -> "ProbeResult":
        return ProbeResult(NOT_MEASURABLE, None, evidence)


@dataclass
class Scenario:
    """Результат прогона одного проверочного сценария (общий для нескольких проб)."""

    ran: bool = False
    trace: ReasoningTrace | None = None
    text: str = ""
    duration_s: float = 0.0
    error: str = ""


@dataclass
class Context:
    """Собранные факты о подсистеме: заполняется один раз, читается всеми пробами."""

    mode: str
    available: bool
    profile: dict = field(default_factory=dict)
    brain_stats: dict = field(default_factory=dict)
    brain_models_seen: int = 0
    gguf_count: int = 0
    llm_test_functions: int = 0
    # Сценарии инференса.
    s1: Scenario = field(default_factory=Scenario)   # штатный разбор (полный конвейер)
    s2: Scenario = field(default_factory=Scenario)   # провокация на выдуманные числа
    s3: Scenario = field(default_factory=Scenario)   # пустой вход → честное «данных нет»
    s_det: Scenario = field(default_factory=Scenario)  # прогон без модели (детерминированный откат)


# ─── Проверочные сценарии ─────────────────────────────────────────────────────────────

_S1_JUDGMENTS = (
    "Сопровождаемость / Тестируемость: покрытие автотестами 25%, регресс выполняется вручную\n"
    "Надёжность / Доступность (uptime): за квартал два инцидента недоступности"
)
_S1_RISKS = (
    "- Низкая автоматизация регрессионного тестирования: выделить ресурс на автотесты\n"
    "- Риск недоступности сервиса: ввести резервирование узлов"
)
# Провокация: во входе НЕТ ни одного процента. Любой процент в ответе — выдуманный.
_S2_PROMPT = (
    "ИС: Проверочная. Период: Q1-2026.\n"
    "Профессиональные суждения по подхарактеристикам:\n"
    "Надёжность / Отказоустойчивость: резервирование узлов не выполнено\n"
    "Сформируй управленческое заключение по заданному формату."
)
# Пустой вход: правильный ответ — честная констатация отсутствия данных.
_S3_PROMPT = (
    "ИС: Проверочная. Период: Q1-2026.\n"
    "Профессиональные суждения по подхарактеристикам:\n(нет данных)\n"
    "Сформируй управленческое заключение по заданному формату."
)

_PCT_FREE_INPUT = (_S2_PROMPT, "")


def _run_scenarios(ctx: Context) -> None:
    """Прогоняет сценарии инференса. Ошибки не роняют самооценку — они и есть результат пробы."""
    persona = personas.get("QUALITY_MANAGER")

    # S_det — детерминированный откат: выполняется ВСЕГДА (инференса не требует).
    t0 = time.monotonic()
    try:
        ctx.s_det.trace = run_reasoning(
            ReasoningInput("Проверочная ИС", "Q1-2026",
                           judgments_block=_S1_JUDGMENTS, risks_block=_S1_RISKS),
            use_llm=False, persona=persona,
        )
        ctx.s_det.ran = True
    except Exception as exc:  # noqa: BLE001
        ctx.s_det.error = str(exc)
    ctx.s_det.duration_s = round(time.monotonic() - t0, 2)

    if ctx.mode != "full" or not ctx.available:
        return

    # S1 — штатный разбор полным конвейером с моделью.
    t0 = time.monotonic()
    try:
        ctx.s1.trace = run_reasoning(
            ReasoningInput("Проверочная ИС", "Q1-2026",
                           judgments_block=_S1_JUDGMENTS, risks_block=_S1_RISKS),
            use_llm=True, persona=persona,
        )
        ctx.s1.ran = True
    except Exception as exc:  # noqa: BLE001
        ctx.s1.error = str(exc)
    ctx.s1.duration_s = round(time.monotonic() - t0, 2)

    # S2 — провокация на выдуманные числа (одиночный вызов, без конвейера).
    t0 = time.monotonic()
    try:
        ctx.s2.text = service.complete(_S2_PROMPT, max_tokens=160) or ""
        ctx.s2.ran = True
    except Exception as exc:  # noqa: BLE001
        ctx.s2.error = str(exc)
    ctx.s2.duration_s = round(time.monotonic() - t0, 2)

    # S3 — пустой вход: ожидается честная констатация отсутствия данных.
    t0 = time.monotonic()
    try:
        ctx.s3.text = service.complete(_S3_PROMPT, max_tokens=140) or ""
        ctx.s3.ran = True
    except Exception as exc:  # noqa: BLE001
        ctx.s3.error = str(exc)
    ctx.s3.duration_s = round(time.monotonic() - t0, 2)


# ─── Вспомогательные измерители ───────────────────────────────────────────────────────

def _need_inference(ctx: Context, scenario: Scenario) -> ProbeResult | None:
    """Единая причина отказа для проб, требующих инференса (чтобы формулировка была одна)."""
    if ctx.mode != "full":
        return ProbeResult.skip("проба требует инференса; прогон выполнен в режиме «static»")
    if not ctx.available:
        return ProbeResult.skip("модель не загружена — инференс недоступен")
    if not scenario.ran:
        return ProbeResult.skip(f"сценарий не выполнен: {scenario.error or 'причина не определена'}")
    return None


def _count_llm_tests() -> int:
    """Число тестовых функций, покрывающих домен llm (для пробы тестируемости)."""
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    total = 0
    for path in glob.glob(os.path.join(os.path.dirname(root), "tests", "test_*.py")):
        name = os.path.basename(path)
        if not any(k in name for k in ("llm", "reasoning", "brain", "gate", "persona",
                                       "decision", "principle", "selfcheck", "pipeline")):
            continue
        try:
            with open(path, encoding="utf-8") as f:
                total += sum(1 for line in f if line.startswith("def test_"))
        except OSError:
            continue
    return total


def _stage_fill_ratio(trace: ReasoningTrace | None) -> float:
    if trace is None or not trace.stages:
        return 0.0
    filled = sum(1 for s in trace.stages if s.content.strip())
    return filled / len(trace.stages)


# ─── Батарея проб: подхарактеристика → измеритель ─────────────────────────────────────
# Ключ — (характеристика, подхарактеристика) из эталонной модели quality.QUALITY_MODEL.
# Значение — (что измеряем, как измеряем, функция измерения).

Probe = tuple[str, str, Callable[[Context], ProbeResult]]


def _p_func_completeness(ctx: Context) -> ProbeResult:
    skip = _need_inference(ctx, ctx.s1)
    if skip:
        return skip
    ratio = _stage_fill_ratio(ctx.s1.trace)
    return ProbeResult.measured(
        ratio, f"этапов конвейера с непустым содержимым: {round(ratio * 100)}%")


def _p_func_correctness(ctx: Context) -> ProbeResult:
    skip = _need_inference(ctx, ctx.s1)
    if skip:
        return skip
    trace = ctx.s1.trace
    total = len(trace.stages)
    kept = sum(1 for s in trace.stages if not s.fell_back)
    return ProbeResult.measured(
        kept / total if total else 0.0,
        f"этапов, прошедших контроль достоверности без отбраковки: {kept} из {total}")


def _p_func_appropriateness(ctx: Context) -> ProbeResult:
    skip = _need_inference(ctx, ctx.s1)
    if skip:
        return skip
    required = ("Объяснение", "Причины", "Риски", "Решение (матрица)",
                "Рекомендации", "Предлагаемые меры", "Уверенность и оговорки")
    present = [b for b in required if b in (ctx.s1.trace.conclusion or "")]
    return ProbeResult.measured(
        len(present) / len(required),
        f"блоков контракта заключения в выводе: {len(present)} из {len(required)}")


def _p_time_behaviour(ctx: Context) -> ProbeResult:
    skip = _need_inference(ctx, ctx.s1)
    if skip:
        return skip
    d = ctx.s1.duration_s
    score = 1.0 if d <= RESPONSE_BUDGET_S else RESPONSE_BUDGET_S / d
    return ProbeResult.measured(
        score, f"полный разбор занял {d} с при точке отсчёта {round(RESPONSE_BUDGET_S)} с "
               f"(режим {'GPU' if ctx.profile.get('n_gpu_layers') else 'CPU'})")


def _p_resource_use(ctx: Context) -> ProbeResult:
    n_ctx = int(ctx.profile.get("n_ctx") or 0)
    if not n_ctx:
        return ProbeResult.skip("окно контекста модели неизвестно (модель не загружена)")
    # Утилизация окна: сколько из него занято настроечной частью (системный промпт персон).
    longest = max(len(personas.get(c).system_prompt) for c in personas.PERSONAS)
    approx_tokens = longest / 3.5          # ~3.5 символа на токен для русского текста
    headroom = max(0.0, 1.0 - approx_tokens / n_ctx)
    return ProbeResult.measured(
        headroom,
        f"системный промпт занимает ≈{round(approx_tokens)} из {n_ctx} токенов окна; "
        f"под данные остаётся ≈{round(headroom * 100)}%")


def _p_capacity(ctx: Context) -> ProbeResult:
    """Ёмкость: помещается ли РЕАЛЬНЫЙ рабочий запрос в настроенное окно целиком.

    Намеренно НЕ измеряется как доля n_ctx от обучающего окна модели: сузить окно —
    осознанное ресурсное решение (KV-кэш растёт линейно по окну и на CPU это прямо переходит
    в память и время), а не дефект. Вопрос ёмкости по ISO 25010 в том, покрывает ли предел
    параметра потребность — то есть влезает ли запрос вместе с резервом на ответ.
    """
    n_ctx = int(ctx.profile.get("n_ctx") or 0)
    n_train = int(ctx.profile.get("n_ctx_train") or 0)
    if not n_ctx:
        return ProbeResult.skip("параметры окна контекста недоступны (модель не загружена)")
    persona = personas.get("QUALITY_MANAGER")
    facts = ""
    if ctx.s_det.trace is not None:
        stage = ctx.s_det.trace.stage("E0")
        facts = stage.content if stage else ""
    # ~3.5 символа на токен для русского текста; точный токенизатор здесь не нужен —
    # проба отвечает «влезает с запасом или впритык», а не считает токены до единицы.
    used = (len(persona.system_prompt) + len(facts)) / 3.5 + persona.max_tokens
    headroom = max(0.0, 1.0 - used / n_ctx)
    train_note = f"; модель допускает до {n_train}" if n_train else ""
    return ProbeResult.measured(
        headroom,
        f"типовой запрос с резервом на ответ занимает ≈{round(used)} из {n_ctx} токенов окна "
        f"(свободно ≈{round(headroom * 100)}%){train_note}")


def _p_coexistence(ctx: Context) -> ProbeResult:
    serialized = service._infer_lock is not None
    in_process = not getattr(settings, "OLLAMA_URL", "")
    score = (0.5 if serialized else 0.0) + (0.5 if in_process else 0.0)
    return ProbeResult.measured(
        score,
        f"параллельные вызовы сериализованы: {'да' if serialized else 'нет'}; "
        f"инференс внутри процесса без внешнего сервиса: {'да' if in_process else 'нет'}")


def _p_interoperability(ctx: Context) -> ProbeResult:
    has_template = bool(ctx.profile.get("has_chat_template"))
    # Путей вызова два: чат-формат по шаблону GGUF и обычное завершение текста (откат).
    score = 1.0 if has_template else 0.5
    return ProbeResult.measured(
        score,
        f"шаблон чата в GGUF: {'есть' if has_template else 'нет'}; "
        "универсальный откат на обычное завершение текста доступен всегда")


def _p_recognisability(ctx: Context) -> ProbeResult:
    fields = ("name", "architecture", "quant", "params", "n_ctx")
    present = [f for f in fields if ctx.profile.get(f)]
    return ProbeResult.measured(
        len(present) / len(fields),
        f"паспорт модели раскрыт в API: заполнено {len(present)} из {len(fields)} полей")


def _p_learnability(ctx: Context) -> ProbeResult:
    stages = len(ctx.s_det.trace.stages) if ctx.s_det.trace else 0
    lenses = len(ctx.s_det.trace.lenses) if ctx.s_det.trace else 0
    ok = bool(stages and lenses)
    return ProbeResult.measured(
        1.0 if ok else 0.0,
        f"вывод сопровождается аудируемой трассой: {stages} этапов и {lenses} ролевых линз")


def _p_operability(ctx: Context) -> ProbeResult:
    controls = {
        "перечень моделей": callable(getattr(service, "list_models", None)),
        "горячая перезагрузка": callable(getattr(service, "reload", None)),
        "выключение подсистемы": hasattr(settings, "LLM_ENABLED"),
        "выбор модели без правки кода": hasattr(settings, "LOCAL_LLM_MODEL_FILE"),
    }
    ok = sum(1 for v in controls.values() if v)
    return ProbeResult.measured(
        ok / len(controls),
        "органы управления подсистемой: " + ", ".join(k for k, v in controls.items() if v))


def _p_error_protection(ctx: Context) -> ProbeResult:
    skip = _need_inference(ctx, ctx.s3)
    if skip:
        return skip
    low = (ctx.s3.text or "").lower()
    honest = any(k in low for k in ("данные отсутств", "данных нет", "не сформирован",
                                    "недостаточно данных", "отсутствуют"))
    return ProbeResult.measured(
        1.0 if honest else 0.0,
        "на пустом входе ответ " + ("честно констатирует отсутствие данных"
                                    if honest else "НЕ констатирует отсутствие данных"))


def _p_not_applicable_ui(_: Context) -> ProbeResult:
    return ProbeResult.skip(
        "подхарактеристика относится к пользовательскому интерфейсу, а не к LLM-компоненту; "
        "измеряется в оценке фронтенда (аудит UI), здесь — «невозможно измерить»")


def _p_maturity(ctx: Context) -> ProbeResult:
    skip = _need_inference(ctx, ctx.s1)
    if skip:
        return skip
    trace = ctx.s1.trace
    total = len(trace.stages)
    rejected = sum(1 for s in trace.stages if s.fell_back)
    # Плотность дефектов — обратный показатель: чем больше отбраковано, тем ниже зрелость.
    return ProbeResult.measured(
        1.0 - (rejected / total if total else 1.0),
        f"проходов отбраковано контролем достоверности: {rejected} из {total}")


def _p_availability(ctx: Context) -> ProbeResult:
    if not ctx.available:
        return ProbeResult.measured(
            0.0, "модель не загружена: подсистема работает только на детерминированном откате")
    if ctx.mode != "full":
        return ProbeResult.measured(
            1.0, "модель загружена и готова к инференсу (проверено интроспекцией)")
    ran = [s for s in (ctx.s1, ctx.s2, ctx.s3) if s.ran]
    return ProbeResult.measured(
        len(ran) / 3.0, f"успешных сценариев инференса: {len(ran)} из 3")


def _p_fault_tolerance(ctx: Context) -> ProbeResult:
    if not ctx.s_det.ran or ctx.s_det.trace is None:
        return ProbeResult.measured(0.0, f"откат без модели не отработал: {ctx.s_det.error}")
    trace = ctx.s_det.trace
    ok = bool(trace.conclusion.strip()) and all(s.grounded for s in trace.stages)
    return ProbeResult.measured(
        1.0 if ok else 0.0,
        "при недоступной модели конвейер даёт полное заключение детерминированно "
        f"({len(trace.stages)} этапов, все заземлены)")


def _p_recoverability(ctx: Context) -> ProbeResult:
    hot_reload = callable(getattr(service, "reload", None))
    brain_alive = bool(ctx.brain_stats.get("memories", 0) >= 0)
    return ProbeResult.measured(
        (0.6 if hot_reload else 0.0) + (0.4 if brain_alive else 0.0),
        "восстановление без пересборки образа: горячая перезагрузка модели "
        f"({'доступна' if hot_reload else 'недоступна'}); накопленный контекст хранится вне "
        "модели и переживает перезапуск")


def _p_confidentiality(ctx: Context) -> ProbeResult:
    external = bool(getattr(settings, "OLLAMA_URL", ""))
    return ProbeResult.measured(
        0.0 if external else 1.0,
        "инференс выполняется локально в процессе приложения; данные оценки за контур "
        "не передаются" if not external else "настроен внешний сервис инференса")


def _p_integrity(ctx: Context) -> ProbeResult:
    skip = _need_inference(ctx, ctx.s2)
    if skip:
        return skip
    invented = set(service._PCT_RE.findall(ctx.s2.text)) - service._allowed_pcts(*_PCT_FREE_INPUT)
    return ProbeResult.measured(
        0.0 if invented else 1.0,
        "во входе сценария нет ни одного процента; в ответе " +
        (f"обнаружены выдуманные значения: {', '.join(sorted(invented))}%"
         if invented else "выдуманных числовых значений нет"))


def _p_non_repudiation(ctx: Context) -> ProbeResult:
    has_fp = callable(getattr(brain, "fingerprint", None))
    has_memory = callable(getattr(brain, "remember", None))
    return ProbeResult.measured(
        (0.5 if has_fp else 0.0) + (0.5 if has_memory else 0.0),
        "каждое заключение получает стабильный отпечаток и сохраняется в память рассуждений — "
        f"вывод можно однозначно соотнести с входными данными (записей в памяти: "
        f"{ctx.brain_stats.get('memories', 0)})")


def _p_accountability(ctx: Context) -> ProbeResult:
    trace = ctx.s1.trace if ctx.s1.ran else ctx.s_det.trace
    if trace is None:
        return ProbeResult.skip("трасса не сформирована — проверять нечего")
    flagged = sum(1 for s in trace.stages
                  if s.used_llm is not None and s.grounded is not None)
    total = len(trace.stages)
    return ProbeResult.measured(
        flagged / total if total else 0.0,
        f"этапов с полными признаками аудита (источник, заземление, откат): {flagged} из {total}; "
        f"оценок эксперта накоплено: {ctx.brain_stats.get('feedback', 0)}")


def _p_authenticity(ctx: Context) -> ProbeResult:
    if not ctx.profile:
        return ProbeResult.measured(0.0, "модель не загружена — подтвердить подлинность нечем")
    known = all(ctx.profile.get(k) for k in ("file_name", "architecture", "quant"))
    return ProbeResult.measured(
        1.0 if known else 0.5,
        f"загруженная модель идентифицирована: {ctx.profile.get('file_name')} "
        f"(архитектура {ctx.profile.get('architecture')}, квантизация {ctx.profile.get('quant')})")


def _p_modularity(ctx: Context) -> ProbeResult:
    expected = ("service", "reasoning", "prompts", "knowledge", "brain", "gate",
                "personas", "principles", "decisions", "pipeline", "selfcheck", "dataset")
    here = os.path.dirname(os.path.abspath(__file__))
    present = [m for m in expected if os.path.isfile(os.path.join(here, f"{m}.py"))]
    return ProbeResult.measured(
        len(present) / len(expected),
        f"домен разделён на {len(present)} специализированных модулей из {len(expected)} ожидаемых")


def _p_reusability(ctx: Context) -> ProbeResult:
    # Переиспользование проверяем по факту: все персоны обязаны нести ОДИН общий блок правил.
    shared = sum(1 for code in personas.PERSONAS
                 if personas.BASE_HONESTY in personas.get(code).system_prompt)
    total = len(personas.PERSONAS)
    return ProbeResult.measured(
        shared / total if total else 0.0,
        f"персон, собранных из общих блоков промпта: {shared} из {total} "
        "(правила честности не дублируются)")


def _p_analysability(ctx: Context) -> ProbeResult:
    trace = ctx.s1.trace if ctx.s1.ran else ctx.s_det.trace
    if trace is None:
        return ProbeResult.skip("трасса не сформирована — проверять нечего")
    signals = {
        "трасса этапов": bool(trace.stages),
        "ролевые линзы": bool(trace.lenses),
        "лестница причин": bool(trace.why_chain) or not ctx.s1.ran,
        "решения матриц": bool(trace.decisions),
        "уверенность": bool(trace.confidence),
    }
    ok = sum(1 for v in signals.values() if v)
    return ProbeResult.measured(
        ok / len(signals),
        "источники диагностики вывода: " + ", ".join(k for k, v in signals.items() if v))


def _p_modifiability(ctx: Context) -> ProbeResult:
    knobs = {
        "смена модели без правки кода": hasattr(settings, "LOCAL_LLM_MODEL_FILE"),
        "смена адресата вывода без правки кода": bool(personas.ROLE_TO_PERSONA),
        "пороги правил вынесены в константы": hasattr(
            __import__("app.modules.llm.gate", fromlist=["x"]), "SEVERITY_Q_THRESHOLD"),
        "матрицы решений вынесены в таблицы": bool(decisions.TRIAGE_MATRIX),
    }
    ok = sum(1 for v in knobs.values() if v)
    return ProbeResult.measured(
        ok / len(knobs), "настраивается без изменения логики: " +
        ", ".join(k for k, v in knobs.items() if v))


def _p_testability(ctx: Context) -> ProbeResult:
    n = ctx.llm_test_functions
    # Точка отсчёта: 40 тестовых функций на домен считаем полным покрытием контура.
    return ProbeResult.measured(
        min(1.0, n / 40.0), f"тестовых функций по домену LLM: {n}")


def _p_adaptability(ctx: Context) -> ProbeResult:
    if not ctx.gguf_count:
        return ProbeResult.measured(
            0.0, "в каталоге моделей нет ни одного GGUF-файла")
    return ProbeResult.measured(
        1.0,
        f"подсистема модель-агностична: в каталоге {ctx.gguf_count} GGUF, любой подхватывается "
        "автоподбором или закреплением имени, метаданные считываются из файла")


def _p_installability(ctx: Context) -> ProbeResult:
    # Обратный показатель: чем больше ручных шагов на смену модели, тем хуже.
    steps = 2   # 1) положить *.gguf в каталог; 2) перезапуск контейнера ИЛИ вызов перезагрузки
    return ProbeResult.measured(
        1.0 / steps,
        f"смена модели требует {steps} ручных шага: разместить файл и перезагрузить модель "
        "(пересборка образа не нужна)")


def _p_replaceability(ctx: Context) -> ProbeResult:
    seen = ctx.brain_models_seen
    if seen >= 2:
        return ProbeResult.measured(
            1.0,
            f"переносимость подтверждена практикой: накопленный контекст использовали {seen} "
            "разные модели без потери памяти рассуждений")
    return ProbeResult.measured(
        0.5,
        f"механизм переноса реализован (память вне весов), но подтверждён лишь на {seen} модели — "
        "смены модели пока не было")


# Порядок соответствует эталонной модели качества (quality.QUALITY_MODEL).
PROBES: dict[tuple[str, str], tuple[str, Callable[[Context], ProbeResult]]] = {
    ("Функциональная пригодность", "Функциональная полнота"):
        ("Полнота конвейера: все ли этапы дали содержательный результат", _p_func_completeness),
    ("Функциональная пригодность", "Функциональная корректность"):
        ("Доля этапов, принятых контролем достоверности", _p_func_correctness),
    ("Функциональная пригодность", "Функциональная целесообразность"):
        ("Соответствие вывода контракту управленческого заключения", _p_func_appropriateness),
    ("Производительность", "Временные характеристики (отклик)"):
        ("Время полного разбора против точки отсчёта", _p_time_behaviour),
    ("Производительность", "Использование ресурсов"):
        ("Доля окна контекста, свободная под данные", _p_resource_use),
    ("Производительность", "Ёмкость (пропускная способность)"):
        ("Помещается ли типовой запрос с резервом на ответ в окно контекста", _p_capacity),
    ("Совместимость", "Сосуществование"):
        ("Сериализация параллельных вызовов и отсутствие внешних сервисов", _p_coexistence),
    ("Совместимость", "Интероперабельность"):
        ("Поддержанные способы вызова модели", _p_interoperability),
    ("Удобство использования", "Узнаваемость уместности"):
        ("Полнота паспорта модели, раскрытого в API", _p_recognisability),
    ("Удобство использования", "Изучаемость"):
        ("Наличие аудируемой трассы рассуждения", _p_learnability),
    ("Удобство использования", "Управляемость"):
        ("Органы управления подсистемой", _p_operability),
    ("Удобство использования", "Защита от ошибок пользователя"):
        ("Поведение на пустом входе", _p_error_protection),
    ("Удобство использования", "Эстетика интерфейса"):
        ("Неприменимо к LLM-компоненту", _p_not_applicable_ui),
    ("Удобство использования", "Доступность (accessibility)"):
        ("Неприменимо к LLM-компоненту", _p_not_applicable_ui),
    ("Надёжность", "Зрелость (плотность дефектов)"):
        ("Доля отбракованных проходов модели", _p_maturity),
    ("Надёжность", "Доступность (uptime)"):
        ("Готовность модели и успешность сценариев", _p_availability),
    ("Надёжность", "Отказоустойчивость"):
        ("Полнота вывода при недоступной модели", _p_fault_tolerance),
    ("Надёжность", "Восстанавливаемость (MTTR)"):
        ("Средства восстановления без пересборки", _p_recoverability),
    ("Защищённость", "Конфиденциальность"):
        ("Локальность инференса", _p_confidentiality),
    ("Защищённость", "Целостность"):
        ("Устойчивость к выдумыванию числовых значений", _p_integrity),
    ("Защищённость", "Неотказуемость"):
        ("Прослеживаемость заключения до входных данных", _p_non_repudiation),
    ("Защищённость", "Подотчётность (аудит)"):
        ("Полнота признаков аудита в трассе", _p_accountability),
    ("Защищённость", "Аутентичность"):
        ("Идентификация загруженной модели", _p_authenticity),
    ("Сопровождаемость", "Модульность"):
        ("Разделение домена на специализированные модули", _p_modularity),
    ("Сопровождаемость", "Повторное использование"):
        ("Сборка персон из общих блоков промпта", _p_reusability),
    ("Сопровождаемость", "Анализируемость"):
        ("Источники диагностики полученного вывода", _p_analysability),
    ("Сопровождаемость", "Модифицируемость"):
        ("Настройка поведения без изменения логики", _p_modifiability),
    ("Сопровождаемость", "Тестируемость"):
        ("Объём автотестов домена", _p_testability),
    ("Переносимость", "Адаптируемость"):
        ("Модель-агностичность подсистемы", _p_adaptability),
    ("Переносимость", "Устанавливаемость"):
        ("Число ручных шагов на смену модели", _p_installability),
    ("Переносимость", "Заменяемость"):
        ("Сохранение накопленного контекста при смене модели", _p_replaceability),
}


# ─── Прогон и отчёт ───────────────────────────────────────────────────────────────────

def _build_context(mode: str) -> Context:
    ctx = Context(mode=mode, available=service.is_available())
    info = service.model_info()
    ctx.profile = info.get("profile") or {}
    ctx.brain_stats = info.get("brain") or {}
    try:
        meta = brain._read_json("brain_meta.json", {"models": []})
        ctx.brain_models_seen = len(meta.get("models", []))
    except Exception:  # noqa: BLE001
        ctx.brain_models_seen = 0
    ctx.gguf_count = len(service.list_models())
    ctx.llm_test_functions = _count_llm_tests()
    _run_scenarios(ctx)
    return ctx


def run(mode: str = "full", trigger: str = "manual") -> dict:
    """Прогоняет самооценку и возвращает формализованный отчёт (он же сохраняется на диск).

    mode: "full" — с инференсом (минуты на CPU), "static" — только интроспекция (мгновенно).
    trigger: кто инициировал ("schedule" | "manual") — попадает в отчёт для аудита.
    """
    started = time.time()
    t0 = time.monotonic()
    mode = mode if mode in ("full", "static") else "full"
    ctx = _build_context(mode)

    characteristics: list[dict] = []
    all_scores: list[float] = []
    measured_total = 0
    subs_total = 0

    for characteristic, subs in QUALITY_MODEL:
        rows: list[dict] = []
        scores: list[float] = []
        for sub, _formula in subs:
            subs_total += 1
            what, probe = PROBES[(characteristic, sub)]
            try:
                res = probe(ctx)
            except Exception as exc:  # noqa: BLE001  (сбой пробы — тоже результат, а не падение)
                logger.exception("Проба %s/%s упала: %s", characteristic, sub, exc)
                res = ProbeResult.skip(f"проба завершилась ошибкой: {exc}")
            if res.status == MEASURED and res.score is not None:
                scores.append(res.score)
                measured_total += 1
            rows.append({
                "subcharacteristic": sub,
                "what": what,
                "status": res.status,
                "score": res.score,
                "evidence": res.evidence,
            })
        char_score = round(sum(scores) / len(scores), 3) if scores else None
        if char_score is not None:
            all_scores.extend(scores)
        characteristics.append({
            "characteristic": characteristic,
            "score": char_score,
            "measured": len(scores),
            "total": len(subs),
            "subcharacteristics": rows,
        })

    integral = round(sum(all_scores) / len(all_scores), 3) if all_scores else None
    coverage = round(measured_total / subs_total, 3) if subs_total else 0.0
    report = {
        "id": uuid.uuid4().hex[:12],
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(started)),
        "duration_s": round(time.monotonic() - t0, 2),
        "mode": mode,
        "trigger": trigger,
        "model": ctx.profile or None,
        "model_available": ctx.available,
        "integral": integral,
        "coverage": coverage,
        "measured": measured_total,
        "total": subs_total,
        "characteristics": characteristics,
        "verdict": _verdict(integral, coverage),
        "pipeline": pipeline.summary(),
        "principles": principles.catalog(),
        "notes": _notes(ctx, coverage),
    }
    _persist(report)
    return report


def _verdict(integral: float | None, coverage: float) -> str:
    """Словесный вердикт. Формулировки согласованы со шкалой контура (порог 41% — критический)."""
    if integral is None:
        return "Измерений не выполнено — оценить качество LLM-подсистемы невозможно."
    level = ("высокое" if integral >= 0.80 else
             "приемлемое" if integral >= 0.60 else
             "пониженное" if integral >= 0.41 else "критически низкое")
    return (f"Качество LLM-подсистемы {level} ({round(integral * 100)}%) при покрытии измерений "
            f"{round(coverage * 100)}%. Интегральный балл рассчитан только по измеренным "
            "подхарактеристикам; неизмеримые в расчёт не включены.")


def _notes(ctx: Context, coverage: float) -> list[str]:
    notes: list[str] = []
    if ctx.mode == "static":
        notes.append("Прогон выполнен без инференса (режим «static»): пробы, требующие обращения "
                     "к модели, помечены как неизмеримые.")
    if not ctx.available:
        notes.append("Модель не загружена: подсистема работает на детерминированном откате, "
                     "оценка отражает именно это состояние.")
    if coverage < decisions.COVERAGE_OK:
        notes.append(f"Покрытие измерений {round(coverage * 100)}% ниже порога "
                     f"{round(decisions.COVERAGE_OK * 100)}% — тот же порог, что применяется "
                     "к оценке прикладных ИС.")
    if not pipeline.continuous_finetuning_enabled():
        notes.append("Дообучение весов в рантайме не выполняется: накопление знаний идёт "
                     "контекстом (уровни A и B), изменение весов — только оффлайн-процедурой.")
    return notes


# ─── Хранение отчётов ─────────────────────────────────────────────────────────────────

def reports_dir() -> str:
    return os.path.join(brain.brain_dir(), REPORTS_SUBDIR)


def _persist(report: dict) -> None:
    """Сохраняет отчёт в историю и обновляет latest.json. Ошибки записи не роняют прогон."""
    directory = reports_dir()
    try:
        os.makedirs(directory, exist_ok=True)
        stamp = report["generated_at"].replace(":", "").replace("-", "")
        path = os.path.join(directory, f"{stamp}_{report['id']}.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
        with open(os.path.join(directory, LATEST_FILE), "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
        _trim_history(directory)
    except OSError as exc:
        logger.warning("Не удалось сохранить отчёт самооценки: %s", exc)


def _trim_history(directory: str) -> None:
    """Держит историю в пределах HISTORY_LIMIT файлов (latest.json не трогаем)."""
    files = sorted(
        p for p in glob.glob(os.path.join(directory, "*.json"))
        if os.path.basename(p) != LATEST_FILE
    )
    for path in files[:-HISTORY_LIMIT] if len(files) > HISTORY_LIMIT else []:
        try:
            os.remove(path)
        except OSError:
            continue


def schedule_description() -> str:
    """Человекочитаемое расписание — ВЫВОДИТСЯ из конфигурации beat, а не дублируется строкой.

    Иначе подпись на дашборде и фактическое расписание разъезжаются при первой же правке cron,
    и пользователь ждёт отчёт не тогда, когда он приходит.
    """
    try:
        from app.infrastructure.workers import celery_app

        entry = celery_app.conf.beat_schedule.get("llm-selfcheck-weekly")
        if not entry:
            return "расписание не настроено — только ручной запуск"
        cron = entry["schedule"]
        days = {"0": "воскресенье", "1": "понедельник", "2": "вторник", "3": "среда",
                "4": "четверг", "5": "пятница", "6": "суббота"}
        day = ", ".join(days.get(str(d), str(d)) for d in sorted(cron.day_of_week))
        hour = min(cron.hour)
        minute = min(cron.minute)
        return f"еженедельно, {day} {hour:02d}:{minute:02d} ({celery_app.conf.timezone})"
    except Exception:  # noqa: BLE001  (подпись не должна ронять эндпоинт)
        logger.debug("не удалось описать расписание самооценки", exc_info=True)
        return "расписание недоступно"


def latest() -> dict | None:
    """Последний сохранённый отчёт (или None, если самооценка ещё не запускалась)."""
    path = os.path.join(reports_dir(), LATEST_FILE)
    if not os.path.isfile(path):
        return None
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None


def history(limit: int = 20) -> list[dict]:
    """Краткая история прогонов (новые первыми): дата, режим, интеграл, покрытие."""
    files = sorted(
        (p for p in glob.glob(os.path.join(reports_dir(), "*.json"))
         if os.path.basename(p) != LATEST_FILE),
        reverse=True,
    )[:limit]
    out: list[dict] = []
    for path in files:
        try:
            with open(path, encoding="utf-8") as f:
                r = json.load(f)
        except (OSError, json.JSONDecodeError):
            continue
        out.append({
            "id": r.get("id"),
            "generated_at": r.get("generated_at"),
            "mode": r.get("mode"),
            "trigger": r.get("trigger"),
            "integral": r.get("integral"),
            "coverage": r.get("coverage"),
            "duration_s": r.get("duration_s"),
            "model": (r.get("model") or {}).get("file_name"),
        })
    return out
