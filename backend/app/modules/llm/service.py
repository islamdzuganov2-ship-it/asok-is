"""
service.py — встроенная (in-process) LLM АСОК ИС; домен llm (ТЗ v13).

МОДЕЛЬ-АГНОСТИЧНО (ключевое требование): система принимает ЛЮБУЮ GGUF-модель, положенную в
каталог моделей (settings.LOCAL_LLM_MODEL_DIR), сама опрашивает её метаданные (архитектура,
окно контекста, шаблон чата) и адаптируется под неё. Внешних сервисов (Ollama и т.п.) нет:
модель грузится напрямую через llama-cpp-python (>=0.3, современные архитектуры) из процесса.

Выбор файла модели (discover_model_path):
  • LOCAL_LLM_MODEL_FILE="auto" (по умолчанию) → автоподбор новейшего *.gguf из каталога;
  • иначе — явно заданное имя файла (закрепляет конкретную модель).
Переключение модели = положить новый .gguf и перезапустить контейнер (или POST /reports/llm-reload).

Интроспекция (ModelProfile): после загрузки читаем llm.metadata — general.architecture,
general.name, general.size_label, <arch>.context_length, наличие tokenizer.chat_template —
это и есть «система опрашивает модель сама».

Адаптивный вызов: complete() пробует чат-формат (шаблон из GGUF), при отсутствии/ошибке
шаблона откатывается к обычному завершению (create_completion) — вывод гарантирован на ЛЮБОЙ GGUF.

ЧЕСТНОСТЬ И ОТСУТСТВИЕ ГАЛЛЮЦИНАЦИЙ:
  1) системный промпт жёстко запрещает выдумывать факты и числа;
  2) детерминированная генерация (низкая temperature);
  3) пост-проверка grounding: проценты вне входных данных → честный grounded-резюме.

Поведение деградации: нет файла модели / нет llama_cpp / ошибка инференса → честный
fallback-текст; приложение всегда стартует и работает.

Обратная совместимость: app.services.llm_service — алиас ЭТОГО модуля (sys.modules),
поэтому старые импорты и monkeypatch в тестах работают без изменений.
"""
from __future__ import annotations

import glob
import logging
import os
import re
import threading
from dataclasses import asdict, dataclass

from app.infrastructure.config import settings
from app.modules.llm import brain
from app.modules.llm.prompts import CONCLUSION_SYSTEM_PROMPT, SYSTEM_PROMPT  # noqa: F401  (публичный контракт модуля)

logger = logging.getLogger(__name__)

_PCT_RE = re.compile(r"(\d{1,3})\s*%")
# Квантизация из имени файла (Q4_K_M, IQ3_XS, F16 …) — надёжнее, чем числовой file_type в метаданных.
_QUANT_RE = re.compile(r"\b(IQ\d[_A-Z0-9]*|Q\d[_A-Z0-9]*|BF16|F16|F32)\b", re.IGNORECASE)

_llm = None
_load_attempted = False
_profile: "ModelProfile | None" = None
_lock = threading.Lock()
# llama.cpp НЕ потокобезопасен для параллельного инференса: сериализуем вызовы,
# иначе одновременные запросы (дашборд + заключение) виснут/повреждают состояние.
_infer_lock = threading.Lock()
_cache: dict[int, str] = {}


@dataclass
class ModelProfile:
    """Паспорт загруженной модели — результат самоопроса GGUF (для UI, логов, «мозга»)."""
    path: str
    file_name: str
    name: str = ""
    architecture: str = ""
    quant: str = ""
    params: str = ""
    size_mb: int = 0
    n_ctx: int = 0
    n_ctx_train: int = 0
    n_gpu_layers: int = 0
    chat_format: str = ""
    has_chat_template: bool = False

    def to_dict(self) -> dict:
        return asdict(self)


def discover_model_path() -> str | None:
    """Определяет ФАКТИЧЕСКИ загружаемый GGUF-файл (модель-агностично).

    Приоритет: явное имя LOCAL_LLM_MODEL_FILE (если задано и файл есть) → иначе автоподбор
    новейшего *.gguf из каталога. Так «положил файл — система подхватила» работает без правки кода.
    """
    directory = settings.LOCAL_LLM_MODEL_DIR
    configured = (settings.LOCAL_LLM_MODEL_FILE or "").strip()
    if configured and configured.lower() != "auto":
        explicit = os.path.join(directory, configured)
        if os.path.isfile(explicit):
            return explicit
        logger.warning("LOCAL_LLM_MODEL_FILE=%s не найден в %s — перехожу к автоподбору *.gguf",
                       configured, directory)
    if not os.path.isdir(directory):
        return None
    ggufs = sorted(glob.glob(os.path.join(directory, "*.gguf")),
                   key=os.path.getmtime, reverse=True)
    if not ggufs:
        return None
    chosen = ggufs[0]
    if len(ggufs) > 1:
        logger.info("Найдено %d GGUF в %s; выбран новейший: %s (прочие: %s)",
                    len(ggufs), directory, os.path.basename(chosen),
                    ", ".join(os.path.basename(p) for p in ggufs[1:]))
    return chosen


def _parse_quant(path: str, meta: dict) -> str:
    m = _QUANT_RE.search(os.path.basename(path))
    if m:
        return m.group(1).upper()
    return str(meta.get("general.file_type", "") or "")


def _build_profile(llm, path: str) -> ModelProfile:
    """Самоопрос модели: собирает ModelProfile из метаданных GGUF и параметров рантайма."""
    meta: dict = {}
    try:
        meta = dict(getattr(llm, "metadata", {}) or {})
    except Exception:  # noqa: BLE001
        meta = {}
    arch = str(meta.get("general.architecture", "") or "")
    n_ctx_train = 0
    if arch:
        try:
            n_ctx_train = int(meta.get(f"{arch}.context_length", 0) or 0)
        except (TypeError, ValueError):
            n_ctx_train = 0
    n_ctx = 0
    try:
        n_ctx = int(llm.n_ctx())
    except Exception:  # noqa: BLE001
        n_ctx = 0
    size_mb = int(os.path.getsize(path) / (1024 * 1024)) if os.path.isfile(path) else 0
    return ModelProfile(
        path=path,
        file_name=os.path.basename(path),
        name=str(meta.get("general.name", "") or os.path.basename(path)),
        architecture=arch,
        quant=_parse_quant(path, meta),
        params=str(meta.get("general.size_label", "") or ""),
        size_mb=size_mb,
        n_ctx=n_ctx,
        n_ctx_train=n_ctx_train,
        n_gpu_layers=settings.LLM_N_GPU_LAYERS,
        chat_format=str(getattr(llm, "chat_format", "") or ""),
        has_chat_template=("tokenizer.chat_template" in meta),
    )


def _load_llm():
    """Ленивая потокобезопасная загрузка модели. Возвращает экземпляр или None."""
    global _llm, _load_attempted, _profile
    if _load_attempted:
        return _llm
    with _lock:
        if _load_attempted:
            return _llm
        _load_attempted = True
        if not settings.LLM_ENABLED:
            logger.info("LLM отключён (LLM_ENABLED=false)")
            return None
        model_path = discover_model_path()
        if not model_path or not os.path.isfile(model_path):
            logger.warning(
                "GGUF-модель не найдена в %s — используется честный fallback. "
                "Положите любой *.gguf в этот каталог.", settings.LOCAL_LLM_MODEL_DIR,
            )
            return None
        try:
            from llama_cpp import Llama
        except ImportError:
            logger.warning("llama-cpp-python не установлен — используется fallback.")
            return None
        chat_format = settings.LLM_CHAT_FORMAT
        try:
            _llm = Llama(
                model_path=model_path,
                n_ctx=settings.LLM_N_CTX,
                n_threads=settings.LLM_N_THREADS,
                n_gpu_layers=settings.LLM_N_GPU_LAYERS,
                # "auto" → None: llama.cpp сам определит шаблон чата из метаданных GGUF.
                chat_format=None if (chat_format or "auto").lower() == "auto" else chat_format,
                verbose=False,
            )
            _profile = _build_profile(_llm, model_path)
            logger.info("LLM загружена: %s (arch=%s, ctx=%d, gpu_layers=%d) из %s",
                        _profile.name, _profile.architecture or "?", _profile.n_ctx,
                        _profile.n_gpu_layers, model_path)
            try:
                brain.note_model(_profile.name, _profile.architecture)
            except Exception:  # noqa: BLE001
                logger.debug("brain.note_model пропущен", exc_info=True)
        except Exception as exc:  # noqa: BLE001
            logger.exception("Не удалось загрузить LLM (%s): %s", os.path.basename(model_path), exc)
            _llm = None
            _profile = None
        return _llm


def is_available() -> bool:
    """True, если модель реально загружена и готова к инференсу."""
    return _load_llm() is not None


def list_models() -> list[dict]:
    """Перечень доступных GGUF в каталоге моделей (для UI/переключения): имя, размер, выбран ли."""
    directory = settings.LOCAL_LLM_MODEL_DIR
    selected = discover_model_path()
    selected_abs = os.path.abspath(selected) if selected else None
    out: list[dict] = []
    if os.path.isdir(directory):
        for p in sorted(glob.glob(os.path.join(directory, "*.gguf")), key=os.path.getmtime, reverse=True):
            out.append({
                "file": os.path.basename(p),
                "size_mb": int(os.path.getsize(p) / (1024 * 1024)),
                "selected": (selected_abs is not None and os.path.abspath(p) == selected_abs),
            })
    return out


def reload() -> dict:
    """Горячая перезагрузка модели без рестарта контейнера (после подмены файла в каталоге).

    Сбрасывает загруженный экземпляр и кэш ответов, затем повторно выполняет автоподбор/загрузку.
    Возвращает актуальный model_info().
    """
    global _llm, _load_attempted, _profile
    with _lock:
        _llm = None
        _profile = None
        _load_attempted = False
    _cache.clear()
    _load_llm()
    return model_info()


def model_info() -> dict:
    """Статус LLM для UI-переключателя «Моки ↔ LLM» и панели модели: паспорт модели + мозг."""
    available = is_available()
    info: dict = {
        "enabled": settings.LLM_ENABLED,
        "available": available,
        "model_file": settings.LOCAL_LLM_MODEL_FILE,
        "model_dir": settings.LOCAL_LLM_MODEL_DIR,
        "temperature": settings.LLM_TEMPERATURE,
        "profile": _profile.to_dict() if _profile else None,
    }
    try:
        info["brain"] = brain.stats()
    except Exception:  # noqa: BLE001
        info["brain"] = None
    return info


def _fit_prompt(llm, system: str, prompt: str, reserve_out: int) -> str:
    """Обрезает пользовательский промпт по ТОКЕНАМ под окно контекста n_ctx.

    Иначе длинные факты/глоссарий (особенно у ИС с множеством суждений) переполняют окно
    (llama_cpp бросает «Requested tokens exceed context window»), инференс падает и этап
    молча уходит в детерминированный fallback — то есть «мясо» LLM теряется именно там, где
    данных много. Здесь мы вместо падения оставляем столько фактов, сколько влезает.
    """
    try:
        n_ctx = llm.n_ctx()
    except Exception:  # noqa: BLE001
        return prompt
    # Бюджет на пользовательский промпт = окно − вывод − системный промпт − запас на разметку чата.
    sys_tokens = len(llm.tokenize(system.encode("utf-8"), add_bos=False))
    budget = n_ctx - reserve_out - sys_tokens - 48
    if budget <= 0:
        return prompt
    tokens = llm.tokenize(prompt.encode("utf-8"), add_bos=False)
    if len(tokens) <= budget:
        return prompt
    kept = tokens[:budget]
    try:
        text = llm.detokenize(kept).decode("utf-8", errors="ignore")
    except Exception:  # noqa: BLE001
        # Грубый резерв: обрезка по символам (примерно 4 символа на токен).
        text = prompt[: budget * 4]
    logger.warning("Промпт обрезан под окно контекста: %d → %d токенов", len(tokens), budget)
    return text + "\n…(факты усечены под окно контекста)"


def _render_generic(system: str, prompt: str) -> str:
    """Универсальный текстовый промпт для моделей БЕЗ шаблона чата (base-модели, экзотика).

    Не привязан к конкретному чат-формату — работает на любой GGUF как обычное завершение текста.
    """
    return f"{system}\n\n{prompt}\n\nОтвет:"


def complete(prompt: str, system: str = SYSTEM_PROMPT,
             max_tokens: int | None = None, temperature: float | None = None) -> str | None:
    """Низкоуровневый вызов модели (модель-агностично). Возвращает текст ответа или None.

    Сначала пробуем чат-формат (шаблон из GGUF). Если у модели нет шаблона чата или чат-вызов
    падает, откатываемся к обычному завершению текста (create_completion) — так осмысленный вывод
    получается на ЛЮБОЙ GGUF, а не только на instruct-моделях с чат-разметкой.
    """
    llm = _load_llm()
    if llm is None:
        return None
    reserve_out = max_tokens or settings.LLM_MAX_TOKENS
    prompt = _fit_prompt(llm, system, prompt, reserve_out)
    temp = settings.LLM_TEMPERATURE if temperature is None else temperature
    # 1) Чат-формат (предпочтительно — уважает роль system и разметку модели).
    try:
        with _infer_lock:
            resp = llm.create_chat_completion(
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": prompt},
                ],
                max_tokens=reserve_out,
                temperature=temp,
                top_p=settings.LLM_TOP_P,
            )
        text = (resp["choices"][0]["message"]["content"] or "").strip()
        if text:
            return text
        logger.warning("Чат-вызов дал пустой ответ — пробую обычное завершение (модель без шаблона?)")
    except Exception as exc:  # noqa: BLE001
        logger.warning("Чат-формат недоступен (%s) — откат к обычному завершению текста", exc)
    # 2) Фолбэк: обычное завершение текста (для моделей без чат-шаблона).
    try:
        with _infer_lock:
            resp = llm.create_completion(
                prompt=_render_generic(system, prompt),
                max_tokens=reserve_out,
                temperature=temp,
                top_p=settings.LLM_TOP_P,
            )
        return (resp["choices"][0]["text"] or "").strip() or None
    except Exception as exc:  # noqa: BLE001
        logger.exception("Ошибка инференса LLM (обычное завершение): %s", exc)
        return None


def _allowed_pcts(*texts: str) -> set[str]:
    allowed: set[str] = set()
    for t in texts:
        allowed.update(_PCT_RE.findall(t or ""))
    return allowed


_WORD_RE = re.compile(r"[А-Яа-яЁёA-Za-z]{4,}")


def _is_echo(text: str, *sources: str) -> bool:
    """Вырожденный ответ LLM: маленькая модель «эхом» пересказывает вход, не добавляя своих слов.

    Такой ответ грамматически валиден и не содержит «лишних» процентов, поэтому проходит
    grounding-проверку — но как управленческий вывод он бесполезен (напр. просто перечисляет
    названия характеристик). Считаем ответ эхом, если он почти не привнёс собственной лексики
    поверх входных данных; тогда вызывающий код уходит в честный детерминированный fallback.
    """
    out_w = {w.lower() for w in _WORD_RE.findall(text or "")}
    if len(out_w) < 3:
        return True
    src_w: set[str] = set()
    for s in sources:
        src_w |= {w.lower() for w in _WORD_RE.findall(s or "")}
    novel = out_w - src_w
    return len(novel) < 3 or (len(novel) / len(out_w)) < 0.15


def _grounded_fallback(system_name: str, period_label: str, metrics_block: str) -> str:
    """Честное резюме строго по входным цифрам (без LLM / при недостоверном ответе)."""
    if not metrics_block.strip():
        return (
            f"По ИС «{system_name}» за период {period_label} данные отсутствуют — "
            "автоматический вывод не сформирован."
        )
    # Берём строку с минимальным процентом как «просевшую».
    worst_line, worst_pct = None, None
    for line in metrics_block.splitlines():
        m = _PCT_RE.search(line)
        if m:
            pct = int(m.group(1))
            if worst_pct is None or pct < worst_pct:
                worst_pct, worst_line = pct, line.strip()
    if worst_line is None:
        return (
            f"ИС «{system_name}», период {period_label}: показатели рассчитаны, "
            "процентных отклонений во входных данных не зафиксировано."
        )
    name = worst_line.split("|")[0].strip() or worst_line
    return (
        f"ИС «{system_name}», период {period_label}: наиболее просевшая характеристика — "
        f"«{name}» ({worst_pct}%). Рекомендация: приоритизировать устранение по этой характеристике "
        "и закрепить меру в плане обеспечения качества. "
        "(Вывод сформирован строго по расчётным метрикам, без допущений.)"
    )


def _judgment_fallback(system_name: str, period_label: str, judgments_block: str, risks_block: str) -> str:
    if not judgments_block.strip():
        return (
            f"ИС «{system_name}», период {period_label}: профессиональные суждения ещё не внесены — "
            "заключение не сформировано."
        )
    n = len([ln for ln in judgments_block.splitlines() if ln.strip()])
    risks = ""
    if risks_block.strip():
        risks = f" Возможные риски (из базы): {risks_block.strip().splitlines()[0]}"
    return (
        f"ИС «{system_name}», период {period_label}: на основе {n} профессиональных суждений выявлены зоны "
        f"внимания менеджера по качеству.{risks} Рекомендация: вынести систематически просевшие характеристики "
        "на решение топ-менеджмента. (Заключение сформировано строго по внесённым суждениям.)"
    )


def generate_judgment_conclusion(system_name: str, period_label: str, judgments_block: str,
                                 risks_block: str = "", history_block: str = "") -> str:
    """Заключение LLM по профессиональным суждениям с маппингом на базу рисков.

    «Самообучение» (практическое, без дообучения весов): корпус суждений растёт с каждым вводом,
    а суждения/выводы прошлых периодов по этой ИС передаются как history_block — модель учитывает
    преемственность и с каждым новым вводом даёт более полное заключение (RAG-контекст).
    """
    key = hash((system_name, period_label, judgments_block, risks_block, history_block))
    if key in _cache:
        return _cache[key]
    prompt = (
        f"ИС: {system_name}. Период: {period_label}.\n"
        f"Профессиональные суждения по подхарактеристикам:\n{judgments_block}\n"
        + (f"\nСвязанные риски (база рисков банка):\n{risks_block}\n" if risks_block.strip() else "")
        + (f"\nСуждения/выводы прошлых периодов (для преемственности):\n{history_block}\n" if history_block.strip() else "")
        + "Сформируй управленческое заключение по заданному формату."
    )
    text = complete(prompt, system=CONCLUSION_SYSTEM_PROMPT)
    if text:
        # Grounding: проценты в ответе обязаны присутствовать во входных данных.
        if set(_PCT_RE.findall(text)) - _allowed_pcts(judgments_block, risks_block, history_block):
            logger.warning("Заключение содержит проценты вне входных данных — честный fallback")
            text = None
    if not text:
        text = _judgment_fallback(system_name, period_label, judgments_block, risks_block)
    _cache[key] = text
    return text


def generate_measures_analytics(measures_block: str, risks_block: str = "") -> str:
    """Аналитика LLM по данным о МЕРАХ (не карточки, а сводный вывод по характеристикам)."""
    key = hash(("measures", measures_block, risks_block))
    if key in _cache:
        return _cache[key]
    if not measures_block.strip():
        return "Активных мер нет — аналитика по мерам не сформирована."
    prompt = (
        "Сводка по мерам качества (по характеристикам, число мер и охват ИС):\n"
        f"{measures_block}\n"
        + (f"\nСвязанные риски (база рисков банка):\n{risks_block}\n" if risks_block.strip() else "")
        + "Сформируй краткую АНАЛИТИКУ по мерам для топ-менеджмента: где сосредоточены проблемы "
          "(систематика по характеристикам), что приоритизировать, 1–2 предложения. "
          "Только по переданным данным, без вымысла."
    )
    text = complete(prompt, system=CONCLUSION_SYSTEM_PROMPT)
    if text and (set(_PCT_RE.findall(text)) - _allowed_pcts(measures_block, risks_block)):
        logger.warning("Аналитика по мерам содержит проценты вне входных данных — честный fallback")
        text = None
    if not text:
        text = (
            "Меры сосредоточены по перечисленным характеристикам; приоритет — характеристики с "
            "наибольшим числом мер и охватом ИС. (Сформировано строго по сводке мер.)"
        )
    _cache[key] = text
    return text


def generate_summary(system_name: str, period_label: str,
                     metrics_block: str, known_risks: str = "") -> str:
    """
    Управленческое резюме по метрикам ИС с гарантией grounding.

    metrics_block — строки вида "характеристика | метрика | %".
    known_risks   — релевантные записи из базы рисков (обоснование для LLM), опционально.
    """
    key = hash((system_name, period_label, metrics_block, known_risks))
    if key in _cache:
        return _cache[key]

    risks_part = (
        f"\nИзвестные риски по просевшим характеристикам (из базы рисков банка):\n{known_risks}\n"
        if known_risks else ""
    )
    prompt = (
        f"ИС: {system_name}. Период: {period_label}.\n"
        f"Метрики (характеристика | метрика | %):\n{metrics_block}\n"
        f"{risks_part}"
        "Сформируй управленческий вывод по заданному формату. "
        "Помни: только переданные числа, без домыслов."
    )
    text = complete(prompt)

    if text:
        # Grounding-проверка: проценты в ответе обязаны присутствовать во входных данных.
        allowed = _allowed_pcts(metrics_block, known_risks)
        used = set(_PCT_RE.findall(text))
        hallucinated = used - allowed
        if hallucinated:
            logger.warning(
                "LLM упомянула проценты вне входных данных %s — заменяю на честный fallback",
                sorted(hallucinated),
            )
            text = _grounded_fallback(system_name, period_label, metrics_block)
        elif _is_echo(text, metrics_block, known_risks, system_name, period_label):
            # Маленькая модель вернула «эхо» входа (перечень характеристик) — бесполезно как вывод.
            logger.warning("LLM вернула вырожденный ответ (эхо входных данных) — честный fallback")
            text = _grounded_fallback(system_name, period_label, metrics_block)
    else:
        text = _grounded_fallback(system_name, period_label, metrics_block)

    _cache[key] = text
    return text
