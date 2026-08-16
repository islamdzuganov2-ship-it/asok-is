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
from collections import OrderedDict
from dataclasses import asdict, dataclass

from app.infrastructure.config import settings
from app.modules.llm import brain
from app.modules.llm.personas import EXECUTOR, TOP_MANAGER
from app.modules.llm.prompts import (  # noqa: F401  (публичный контракт модуля)
    CONCLUSION_SYSTEM_PROMPT,
    MEASURE_CARD_SUMMARY_PROMPT,
    SYSTEM_PROMPT,
)

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
# ДЕФ-21 (RES-04): кэш ответов ограничен по числу записей. Раньше это был обычный dict,
# который очищался только при reload() — он рос неограниченно, а каждое значение содержит
# до LLM_MAX_TOKENS текста. Вытеснение — LRU: реже всего используемая запись уходит первой.
_CACHE_MAX_ENTRIES = 256
_cache: "OrderedDict[int, str]" = OrderedDict()
_cache_lock = threading.Lock()


def _cache_get(key: int) -> str | None:
    """Прочитать из кэша, обновив позицию записи (LRU)."""
    with _cache_lock:
        if key not in _cache:
            return None
        _cache.move_to_end(key)
        return _cache[key]


def _cache_put(key: int, text: str) -> None:
    """Положить в кэш, вытеснив самую давнюю запись при переполнении."""
    with _cache_lock:
        _cache[key] = text
        _cache.move_to_end(key)
        while len(_cache) > _CACHE_MAX_ENTRIES:
            _cache.popitem(last=False)


def cache_size() -> int:
    """Текущее число записей в кэше (для диагностики и метрик, RES-12)."""
    with _cache_lock:
        return len(_cache)

# ДЕФ-04. Очередь к модели ограничена: раньше `with _infer_lock` ждал освобождения
# неограниченно долго, каждый ожидающий держал поток из пула asyncio.to_thread, и при
# нескольких параллельных запросах вставали ВСЕ эндпоинты, включая не-LLM.
_waiting = 0
_waiting_lock = threading.Lock()
# Прогрев: фоновая загрузка весов при старте, чтобы первый пользовательский запрос не
# платил за холодный старт (замер: ~10 минут на 6962 МБ).
_warmup_thread: "threading.Thread | None" = None


class LlmBusyError(RuntimeError):
    """Модель занята: очередь заполнена или ожидание превысило бюджет времени.

    Вызывающий обязан отдать честный детерминированный результат, а не висеть.
    """


class _InferSlot:
    """Контекст-менеджер доступа к модели с потолком очереди и бюджетом ожидания."""

    def __enter__(self) -> "_InferSlot":
        global _waiting
        with _waiting_lock:
            if _waiting >= settings.LLM_MAX_WAITING:
                raise LlmBusyError(
                    f"очередь к модели заполнена ({_waiting}/{settings.LLM_MAX_WAITING})"
                )
            _waiting += 1
        try:
            acquired = _infer_lock.acquire(timeout=settings.LLM_QUEUE_TIMEOUT_S)
        finally:
            with _waiting_lock:
                _waiting -= 1
        if not acquired:
            raise LlmBusyError(
                f"модель занята дольше {settings.LLM_QUEUE_TIMEOUT_S:g} с"
            )
        return self

    def __exit__(self, *exc_info) -> None:
        _infer_lock.release()


def queue_depth() -> int:
    """Сколько запросов сейчас ждёт освобождения модели (для диагностики и метрик)."""
    with _waiting_lock:
        return _waiting


def is_loading() -> bool:
    """Идёт ли фоновая загрузка весов прямо сейчас."""
    return _warmup_thread is not None and _warmup_thread.is_alive()


def warmup() -> None:
    """Запустить фоновую загрузку модели (идемпотентно).

    Вызывается на старте приложения. Пока загрузка идёт, `is_available()` честно отвечает
    False, эндпоинты отдают детерминированный fallback, а не блокируются на весах.
    """
    global _warmup_thread
    if not settings.LLM_ENABLED or not settings.LLM_WARMUP:
        return
    if _load_attempted or is_loading():
        return

    def _run() -> None:
        try:
            _load_llm()
        except Exception as exc:  # noqa: BLE001
            logger.warning("Прогрев LLM не удался: %s", exc)

    _warmup_thread = threading.Thread(target=_run, name="llm-warmup", daemon=True)
    _warmup_thread.start()
    logger.info("Прогрев LLM запущен в фоне")


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
    ggufs = _list_gguf(directory)
    if not ggufs:
        return None
    chosen = ggufs[0]
    if len(ggufs) > 1:
        logger.info("Найдено %d GGUF в %s; выбран новейший: %s (прочие: %s)",
                    len(ggufs), directory, os.path.basename(chosen),
                    ", ".join(os.path.basename(p) for p in ggufs[1:]))
    return chosen


def _is_model_gguf(path: str) -> bool:
    """Отсекает вспомогательные GGUF, не являющиеся самостоятельной языковой моделью.

    Напр. `mmproj-*.gguf` — проектор мультимодальных моделей (идёт в пару к основной модели и
    не грузится как LLM). Явно заданный LOCAL_LLM_MODEL_FILE этот фильтр не затрагивает.
    """
    return "mmproj" not in os.path.basename(path).lower()


def _list_gguf(directory: str) -> list[str]:
    """GGUF-кандидаты каталога (без вспомогательных), новейшие первыми."""
    files = [p for p in glob.glob(os.path.join(directory, "*.gguf")) if _is_model_gguf(p)]
    return sorted(files, key=os.path.getmtime, reverse=True)


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
        except Exception as exc:  # noqa: BLE001  (ImportError, а также сбой загрузки нативной libllama)
            logger.warning("llama-cpp-python недоступен (%s) — используется честный fallback.", exc)
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
    """True, если модель УЖЕ загружена и готова к инференсу.

    ДЕФ-04: раньше здесь вызывался `_load_llm()`, поэтому опрос `/reports/llm-status`
    (его дёргает переключатель «Моки ↔ LLM» на каждой загрузке страницы) запускал холодную
    загрузку 6962 МБ под глобальной блокировкой и подвешивал весь бэкенд. Теперь статус
    только ЧИТАЕТ состояние: загрузку выполняет фоновый прогрев (`warmup`), а инференс —
    по факту обращения.
    """
    return _llm is not None


def list_models() -> list[dict]:
    """Перечень доступных GGUF в каталоге моделей (для UI/переключения): имя, размер, выбран ли."""
    directory = settings.LOCAL_LLM_MODEL_DIR
    selected = discover_model_path()
    selected_abs = os.path.abspath(selected) if selected else None
    out: list[dict] = []
    if os.path.isdir(directory):
        for p in _list_gguf(directory):
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
        # ДЕФ-04: фронт отличает «модель грузится» от «модели нет» и не считает стенд сломанным.
        "loading": is_loading(),
        "queue_depth": queue_depth(),
        "cache_size": cache_size(),
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
    if is_loading():
        # ДЕФ-04: пока веса грузятся в фоне, не встаём в очередь на минуты —
        # отдаём None, вызывающий формирует детерминированный результат.
        logger.info("LLM ещё грузится — отдаю детерминированный fallback")
        return None
    llm = _load_llm()
    if llm is None:
        return None
    reserve_out = max_tokens or settings.LLM_MAX_TOKENS
    prompt = _fit_prompt(llm, system, prompt, reserve_out)
    temp = settings.LLM_TEMPERATURE if temperature is None else temperature
    # 1) Чат-формат (предпочтительно — уважает роль system и разметку модели).
    try:
        with _InferSlot():
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
    except LlmBusyError as exc:
        logger.warning("LLM занята (%s) — детерминированный fallback без ожидания", exc)
        return None
    except Exception as exc:  # noqa: BLE001
        logger.warning("Чат-формат недоступен (%s) — откат к обычному завершению текста", exc)
    # 2) Фолбэк: обычное завершение текста (для моделей без чат-шаблона).
    try:
        with _InferSlot():
            resp = llm.create_completion(
                prompt=_render_generic(system, prompt),
                max_tokens=reserve_out,
                temperature=temp,
                top_p=settings.LLM_TOP_P,
            )
        return (resp["choices"][0]["text"] or "").strip() or None
    except LlmBusyError as exc:
        logger.warning("LLM занята (%s) — детерминированный fallback без ожидания", exc)
        return None
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
    cached = _cache_get(key)
    if cached is not None:
        return cached
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
    _cache_put(key, text)
    return text


def generate_measures_analytics(measures_block: str, risks_block: str = "") -> str:
    """Аналитика LLM по данным о МЕРАХ (не карточки, а сводный вывод по характеристикам)."""
    key = hash(("measures", measures_block, risks_block))
    cached = _cache_get(key)
    if cached is not None:
        return cached
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
    _cache_put(key, text)
    return text


def generate_summary(system_name: str, period_label: str,
                     metrics_block: str, known_risks: str = "") -> str:
    """
    Управленческое резюме по метрикам ИС с гарантией grounding.

    metrics_block — строки вида "характеристика | метрика | %".
    known_risks   — релевантные записи из базы рисков (обоснование для LLM), опционально.
    """
    key = hash((system_name, period_label, metrics_block, known_risks))
    cached = _cache_get(key)
    if cached is not None:
        return cached

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

    _cache_put(key, text)
    return text


# ─── Резюме карточки меры для топ-менеджмента (ТЗ v19 п.14, УК-14) ─────────────────────
# Отдельный однопроходный вызов (не общий конвейер reasoning.py: там вход — суждения/риски/
# метрики по всей ИС за период, здесь — уже посчитанные поля ОДНОЙ меры). Берёт системную роль
# и формат персоны TOP_MANAGER напрямую (personas.py) — тот же адресат, та же честность.
#
# Пользователь настоял явно (сессия ТЗ v19): изложение проблемы/решения строится АНАЛИЗОМ
# переданных фактов, а не «подстановкой в формулу» и не переписыванием вслепую. Маленькая
# локальная модель инструкцию формата иногда игнорирует — поэтому контракт (лимит слов, запрет
# жаргона формул, обязательность денег/срока/ответственного) проверяется ПОСЛЕ генерации, а не
# только просьбой в промпте; при нарушении — честный детерминированный fallback (та же
# деградация, что и у остальных generate_* здесь).

_JARGON_RE = re.compile(r"[A-ZА-Я]\s*=|A/B\b|\bDIRECT\b|\bINVERSE\b", re.IGNORECASE)
_ABSENT_MARKERS = ("не оценен", "не назначен", "не сформулирован", "не указан")
_LONG_NUMBER_RE = re.compile(r"\d[\d\s]{3,}\d")


def _word_count(text: str) -> int:
    return len(re.findall(r"\S+", text or ""))


def _has_absence_marker(text: str) -> bool:
    low = (text or "").lower()
    return any(m in low for m in _ABSENT_MARKERS)


def _numbers_in(text: str) -> set[str]:
    return {re.sub(r"\s+", "", n) for n in _LONG_NUMBER_RE.findall(text or "")}


def _covers_money(text: str, money_note: str) -> bool:
    if "не оценен" in money_note.lower():
        return _has_absence_marker(text)
    return "₽" in text or _has_absence_marker(text)


def _covers_deadline(text: str, deadline_note: str) -> bool:
    if "не назначен" in deadline_note.lower():
        return _has_absence_marker(text)
    return bool(re.search(r"\d{1,2}[.\-]\d{1,2}", text)) or _has_absence_marker(text)


def _covers_responsible(text: str, responsible_name: str | None) -> bool:
    if not responsible_name:
        return _has_absence_marker(text)
    return responsible_name.lower() in text.lower() or _has_absence_marker(text)


_TOKEN_RE = re.compile(r"[а-яё]{6,}")


def _covers_ask(text: str, ask: str, problem: str) -> bool:
    """Проверка, что «решение» (запрошенное у ЛПР действие) отражено, а не потеряно за
    пересказом проблемы. Найдено эмпирически (браузерная проверка): маленькая модель иногда
    пересказывает факты «Что не так»/«Деньги»/«Срок»/«Ответственный» и МОЛЧА теряет именно
    раздел «Решение» — деньги/срок/ответственный при этом проходят отдельные проверки выше,
    так что без этой проверки брак было бы не поймать.

    Слова, общие с «problem» (проблема и решение часто говорят об одном и том же — общая
    лексика неизбежна), исключаются из сравнения, иначе проверка ложно засчитывала бы пересказ
    проблемы за отражение решения."""
    if "не сформулирован" in ask.lower():
        return _has_absence_marker(text)
    ask_tokens = set(_TOKEN_RE.findall(ask.lower()))
    distinctive = ask_tokens - set(_TOKEN_RE.findall(problem.lower()))
    if not distinctive:
        distinctive = ask_tokens
    if not distinctive:
        return True  # в «ask» нет содержательных слов ≥6 букв — проверять нечего
    low = text.lower()
    return any(t in low for t in distinctive) or _has_absence_marker(text)


def _management_summary_fallback(
    problem: str, ask: str, money_note: str, deadline_note: str,
    cost_note: str, result_note: str, responsible_note: str,
) -> str:
    """Детерминированная запись по тому же контракту (лимит слов, честные пометки «не
    оценено»/«не назначен») — когда LLM недоступна или её ответ не проходит проверку ниже.
    Свободный текст полей (обоснование/ожидание) обрезается по словам, не по символам, и
    помечается «…» — это честное сокращение изложения, а не домысливание содержания."""
    def _clip(s: str, n: int) -> str:
        words = (s or "").split()
        return (s or "").strip() if len(words) <= n else " ".join(words[:n]) + "…"

    sentences = [
        f"Что не так: {_clip(problem, 18) or 'проблема не описана в обосновании меры'}.",
        f"Деньги и срок: {money_note}; {deadline_note}.",
        f"Решение: {_clip(ask, 14) or 'конкретное решение от руководителя не сформулировано'}.",
        f"Стоимость: {cost_note}.",
        f"Результат: {result_note}.",
        f"Ответственный: {responsible_note}.",
    ]
    text = " ".join(sentences)
    words = text.split()
    return text if len(words) <= 80 else " ".join(words[:80]) + "…"


def generate_management_summary(
    problem: str, ask: str, money_note: str, deadline_note: str,
    cost_note: str, result_note: str, responsible_note: str,
    responsible_name: str | None = None,
) -> str:
    """Управленческая записка по одной мере — контракт «что не так → деньги/срок → решение →
    стоимость → результат → ответственный», ≤80 слов, без формул/технических обозначений.

    `*_note` — уже честно оформленные строки («500 000 ₽/год» либо «не оценено», «до
    01.09.2026» либо «не назначен») — их готовит вызывающий код (домен governance, который
    один знает поля Proposal); эта функция ORM не импортирует. `responsible_name` — «сырое»
    имя ответственного, только чтобы проверить, что LLM его не потеряла при пересказе.
    """
    key = hash(("mgmt_summary", problem, ask, money_note, deadline_note,
                cost_note, result_note, responsible_note))
    cached = _cache_get(key)
    if cached is not None:
        return cached

    fallback = _management_summary_fallback(
        problem, ask, money_note, deadline_note, cost_note, result_note, responsible_note,
    )

    facts = (
        f"Что не так: {problem}\n"
        f"Решение (ожидание от руководителя): {ask}\n"
        f"Деньги (цена бездействия): {money_note}\n"
        f"Срок: {deadline_note}\n"
        f"Стоимость решения: {cost_note}\n"
        f"Ожидаемый результат: {result_note}\n"
        f"Ответственный: {responsible_note}"
    )
    text = complete(MEASURE_CARD_SUMMARY_PROMPT.format(facts=facts),
                    system=TOP_MANAGER.system_prompt, max_tokens=TOP_MANAGER.max_tokens)

    if text:
        reasons = []
        if _word_count(text) > 80:
            reasons.append("превышен лимит 80 слов")
        if _JARGON_RE.search(text):
            reasons.append("технический жаргон формул в тексте для руководителя")
        if _numbers_in(text) - _numbers_in(facts):
            reasons.append("числа вне переданных фактов")
        if not _covers_money(text, money_note):
            reasons.append("денежная оценка не отражена")
        if not _covers_deadline(text, deadline_note):
            reasons.append("срок не отражён")
        if not _covers_responsible(text, responsible_name):
            reasons.append("ответственный не отражён")
        if not _covers_ask(text, ask, problem):
            reasons.append("решение (запрошенное действие) не отражено")
        if reasons:
            logger.warning("Резюме карточки меры отбраковано (%s) — честный fallback", "; ".join(reasons))
            text = fallback
    else:
        text = fallback

    _cache_put(key, text)
    return text


# ─── Мера на язык исполнителя (ТЗ v19 п.16, УК-16) ─────────────────────────────────────
# Персона EXECUTOR (personas.py) уже задаёт нужный формат («Что сделать / Срок и риск / Чем
# подтвердить / Что уточнить») — конвейер Э0–Э7 не нужен, вход короче (одна мера). Та же
# деградация к честному fallback'у, но БЕЗ строгого лимита 80 слов (это требование заказчика
# только для управленческой записки, п.14) — только запрет жаргона формул и grounding по числам.

def _executor_brief_fallback(ask: str, problem: str, due_note: str) -> str:
    action = (ask or problem or "").strip()
    if not action:
        action = "шаги не сформулированы в мере — уточните у менеджера по качеству"
    words = action.split()
    if len(words) > 40:
        action = " ".join(words[:40]) + "…"
    return (
        f"Что сделать: {action}. Срок: {due_note}. "
        "Чем подтвердить: отчёт менеджеру по качеству о выполнении (что сделано, результат)."
    )


def generate_executor_brief(title: str, problem: str, ask: str, due_note: str) -> str:
    """Мера, переписанная на язык исполнителя — конкретные шаги вместо профессионального
    суждения менеджера по качеству (rationale) и вместо запроса решения у ЛПР (expectation,
    п.14 — другой адресат). `due_note` — уже честно оформлен («до 01.10.2026» либо «не
    назначен») вызывающим кодом (governance), как в generate_management_summary."""
    key = hash(("executor_brief", title, problem, ask, due_note))
    cached = _cache_get(key)
    if cached is not None:
        return cached

    fallback = _executor_brief_fallback(ask, problem, due_note)

    facts = (
        f"Поручение: {title}\n"
        f"Контекст (профессиональное суждение менеджера по качеству): {problem}\n"
        f"Требуемое решение/мера: {ask}\n"
        f"Срок: {due_note}"
    )
    prompt = (
        f"Факты по поручению (используй ТОЛЬКО их, ничего не добавляй от себя):\n{facts}\n"
        "Перепиши поручение для исполнителя по формату из системной роли, не более 120 слов "
        "суммарно. Если срок «не назначен» — так и напиши, не придумывай дату."
    )
    text = complete(prompt, system=EXECUTOR.system_prompt, max_tokens=EXECUTOR.max_tokens)

    if text:
        reasons = []
        if _word_count(text) > 120:
            reasons.append("превышен разумный объём")
        if _JARGON_RE.search(text):
            reasons.append("технический жаргон формул")
        if _numbers_in(text) - _numbers_in(facts):
            reasons.append("числа вне переданных фактов")
        if _is_echo(text, facts):
            # Найдено эмпирически (браузерная проверка): маленькая модель иногда пересказывает
            # факты СВОИМИ ЖЕ ЛЕЙБЛАМИ («Поручение:/Контекст:/Решение:») вместо формата
            # персоны — грамматически валидно, проходит остальные проверки, но не решение
            # заказчика «через анализ, не переписыванием вслепую» (см. docstring выше).
            reasons.append("эхо входных фактов без переработки в формат для исполнителя")
        if reasons:
            logger.warning("Переписанное поручение отбраковано (%s) — честный fallback", "; ".join(reasons))
            text = fallback
    else:
        text = fallback

    _cache_put(key, text)
    return text
