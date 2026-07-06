"""
service.py — встроенная (in-process) LLM АСОК ИС; домен llm (ТЗ v13).

Без внешних сервисов (Ollama и т.п.): модель в формате GGUF загружается напрямую
через llama-cpp-python из локальной директории и вызывается из процесса backend/celery.

Путь к модели: settings.LLM_MODEL_PATH (по умолчанию models/llm/asok-model.gguf).
Рекомендуемая модель: Qwen2.5-1.5B-Instruct Q4_K_M (стандартная архитектура GGUF `qwen2`).
NB: модель с архитектурой `qwen35` (Qwen3.5) текущим рантаймом не грузится — см. docs/LLM_SETUP.md.

ЧЕСТНОСТЬ И ОТСУТСТВИЕ ГАЛЛЮЦИНАЦИЙ (ключевое требование):
  1) системный промпт жёстко запрещает выдумывать факты и числа;
  2) детерминированная генерация (низкая temperature);
  3) пост-проверка grounding: если ответ содержит проценты, которых НЕ было во входных
     данных, ответ считается недостоверным и заменяется честным grounded-резюме.

Поведение деградации: нет файла модели / нет llama_cpp / ошибка инференса → честный
fallback-текст; приложение всегда стартует и работает.

Обратная совместимость: app.services.llm_service — алиас ЭТОГО модуля (sys.modules),
поэтому старые импорты и monkeypatch в тестах работают без изменений.
"""
from __future__ import annotations

import logging
import os
import re
import threading

from app.infrastructure.config import settings
from app.modules.llm.prompts import CONCLUSION_SYSTEM_PROMPT, SYSTEM_PROMPT  # noqa: F401  (публичный контракт модуля)

logger = logging.getLogger(__name__)

_PCT_RE = re.compile(r"(\d{1,3})\s*%")

_llm = None
_load_attempted = False
_lock = threading.Lock()
# llama.cpp НЕ потокобезопасен для параллельного инференса: сериализуем вызовы,
# иначе одновременные запросы (дашборд + заключение) виснут/повреждают состояние.
_infer_lock = threading.Lock()
_cache: dict[int, str] = {}


def _load_llm():
    """Ленивая потокобезопасная загрузка модели. Возвращает экземпляр или None."""
    global _llm, _load_attempted
    if _load_attempted:
        return _llm
    with _lock:
        if _load_attempted:
            return _llm
        _load_attempted = True
        if not settings.LLM_ENABLED:
            logger.info("LLM отключён (LLM_ENABLED=false)")
            return None
        model_path = settings.LLM_MODEL_PATH
        if not os.path.isfile(model_path):
            logger.warning(
                "Файл модели LLM не найден: %s — используется честный fallback. "
                "Положите GGUF-модель по этому пути.", model_path,
            )
            return None
        try:
            from llama_cpp import Llama
        except ImportError:
            logger.warning("llama-cpp-python не установлен — используется fallback.")
            return None
        try:
            _llm = Llama(
                model_path=model_path,
                n_ctx=settings.LLM_N_CTX,
                n_threads=settings.LLM_N_THREADS,
                n_gpu_layers=settings.LLM_N_GPU_LAYERS,
                verbose=False,
            )
            logger.info("LLM загружена из %s", model_path)
        except Exception as exc:  # noqa: BLE001
            logger.exception("Не удалось загрузить LLM: %s", exc)
            _llm = None
        return _llm


def is_available() -> bool:
    """True, если модель реально загружена и готова к инференсу."""
    return _load_llm() is not None


def model_info() -> dict:
    """Статус LLM для UI-переключателя «Моки ↔ LLM»."""
    return {
        "enabled": settings.LLM_ENABLED,
        "available": is_available(),
        "model_file": settings.LOCAL_LLM_MODEL_FILE,
        "model_path": settings.LLM_MODEL_PATH,
        "temperature": settings.LLM_TEMPERATURE,
    }


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


def complete(prompt: str, system: str = SYSTEM_PROMPT,
             max_tokens: int | None = None, temperature: float | None = None) -> str | None:
    """Низкоуровневый вызов чата. Возвращает текст ответа или None при недоступности."""
    llm = _load_llm()
    if llm is None:
        return None
    reserve_out = max_tokens or settings.LLM_MAX_TOKENS
    prompt = _fit_prompt(llm, system, prompt, reserve_out)
    try:
        with _infer_lock:
            resp = llm.create_chat_completion(
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": prompt},
                ],
                max_tokens=reserve_out,
                temperature=settings.LLM_TEMPERATURE if temperature is None else temperature,
                top_p=settings.LLM_TOP_P,
            )
        return resp["choices"][0]["message"]["content"].strip()
    except Exception as exc:  # noqa: BLE001
        logger.exception("Ошибка инференса LLM: %s", exc)
        return None


def _allowed_pcts(*texts: str) -> set[str]:
    allowed: set[str] = set()
    for t in texts:
        allowed.update(_PCT_RE.findall(t or ""))
    return allowed


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
    return (
        f"ИС «{system_name}», период {period_label}: наиболее просевший показатель — "
        f"«{worst_line}». Рекомендация: приоритизировать устранение по этой характеристике "
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
    else:
        text = _grounded_fallback(system_name, period_label, metrics_block)

    _cache[key] = text
    return text
