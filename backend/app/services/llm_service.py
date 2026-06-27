"""
llm_service.py — встроенная (in-process) LLM для АСОК ИС.

Без внешних сервисов (Ollama и т.п.): модель в формате GGUF загружается напрямую
через llama-cpp-python из локальной директории и вызывается из процесса backend/celery.

Путь к модели: settings.LLM_MODEL_PATH (по умолчанию models/llm/asok-model.gguf).
Используемая модель: Qwen (9B, квантизация Q4_K_M), имя файла asok-model.gguf.

ЧЕСТНОСТЬ И ОТСУТСТВИЕ ГАЛЛЮЦИНАЦИЙ (ключевое требование):
  1) системный промпт жёстко запрещает выдумывать факты и числа;
  2) детерминированная генерация (низкая temperature);
  3) пост-проверка grounding: если ответ содержит проценты, которых НЕ было во входных
     данных, ответ считается недостоверным и заменяется честным grounded-резюме.

Поведение деградации: нет файла модели / нет llama_cpp / ошибка инференса → честный
fallback-текст; приложение всегда стартует и работает.
"""
from __future__ import annotations

import logging
import os
import re
import threading

from app.core.config import settings

logger = logging.getLogger(__name__)

# Системный промпт: роль, формат и СТРОГИЕ правила честности (anti-hallucination).
SYSTEM_PROMPT = (
    "Ты — ИТ-директор банка и аналитик качества информационных систем "
    "(методика МК_8.1, ISO/IEC 25010). Твоя главная ценность — ЧЕСТНОСТЬ и точность.\n"
    "СТРОГИЕ ПРАВИЛА (нарушать запрещено):\n"
    "1. Используй ТОЛЬКО факты и числа, явно переданные во входных данных. "
    "Не придумывай метрики, проценты, названия систем, фамилии, суммы и сроки.\n"
    "2. Если каких-то данных нет — прямо напиши «данные отсутствуют», не домысливай.\n"
    "3. Не делай прогнозов и оценок, не подкреплённых входными цифрами.\n"
    "4. Числа в ответе должны дословно совпадать с входными.\n"
    "ФОРМАТ ОТВЕТА (деловой стиль, русский язык):\n"
    "— Резюме состояния в 2–3 предложения, опираясь только на переданные метрики.\n"
    "— Одна конкретная рекомендация к действию.\n"
    "— Наиболее просевшая характеристика (по минимальному проценту)."
)

_PCT_RE = re.compile(r"(\d{1,3})\s*%")

_llm = None
_load_attempted = False
_lock = threading.Lock()
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


def complete(prompt: str, system: str = SYSTEM_PROMPT,
             max_tokens: int | None = None, temperature: float | None = None) -> str | None:
    """Низкоуровневый вызов чата. Возвращает текст ответа или None при недоступности."""
    llm = _load_llm()
    if llm is None:
        return None
    try:
        resp = llm.create_chat_completion(
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
            max_tokens=max_tokens or settings.LLM_MAX_TOKENS,
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
