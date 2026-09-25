"""
Конфигурация логирования (ИБ-09; SEC-03, SEC-16 в docs/SECURITY_AUDIT_RF_2026-09-08.md).

До ИБ-09 логирование не настраивалось вовсе: `LOG_LEVEL` из .env нигде не читался, строки
шли в stdout без формата и без идентификатора запроса, а значения конфигурации интеграций
(URL с токенами) и ФИО из уведомлений писались как есть.

Что даёт модуль:
  • `dictConfig` с уровнем `LOG_LEVEL` и форматом `LOG_FORMAT` (json — для SIEM, text — для
    чтения глазами на стенде);
  • сквозной `request_id` в каждой строке (ContextVar из request_context);
  • `PiiMaskingFilter` — маскирует ПДн и секреты в ГОТОВОМ сообщении (после подстановки
    аргументов), в том числе в логах uvicorn/celery: e-mail, телефоны, СНИЛС, ИНН, номера
    карт, JWT и Bearer-токены, пароли/ключи в параметрах, пароль в URL, ФИО.

Маскирование — вторая линия, а не первая: код по-прежнему не должен класть ПДн в лог.
Фильтр страхует от того, что всё равно просочится (сторонние библиотеки, исключения).
"""
from __future__ import annotations

import json
import logging
import logging.config
import re
from datetime import datetime, timezone

from app.infrastructure.request_context import request_id_var

MASK = "***"

# Порядок важен: сначала длинные/структурные шаблоны (токены, URL), затем цифровые.
_RULES: list[tuple[re.Pattern[str], str]] = [
    # JWT: три base64url-сегмента, первый начинается с eyJ ({"...).
    (re.compile(r"\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}"), "[JWT]"),
    (re.compile(r"(?i)\b(bearer)\s+[A-Za-z0-9._~+/=-]{8,}"), r"\1 " + MASK),
    # Пароль в URL: scheme://user:pass@host → scheme://user:***@host.
    (re.compile(r"(?i)\b([a-z][a-z0-9+.-]*://[^\s:/@]+):[^\s@/]+@"), r"\1:" + MASK + "@"),
    # key=value / "key": "value" для секретных ключей.
    (re.compile(
        r"(?i)(\b(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?token|refresh[_-]?token|"
        r"authorization|jwt[_-]?secret(?:[_-]?key)?)\b[\"']?\s*[:=]\s*[\"']?)([^\s\"'&,;}]+)"
    ), r"\1" + MASK),
    (re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"), "[EMAIL]"),
    # Номер карты: 13–19 цифр, допускаются пробелы/дефисы между группами.
    (re.compile(r"(?<![\d-])(?:\d[ -]?){12,18}\d(?![\d-])"), "[CARD]"),
    # СНИЛС: 123-456-789 01.
    (re.compile(r"\b\d{3}-\d{3}-\d{3}[ -]\d{2}\b"), "[СНИЛС]"),
    # Телефон РФ: +7/8 и 10 цифр в распространённых форматах.
    (re.compile(r"(?<!\d)(?:\+7|8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}(?!\d)"), "[PHONE]"),
    # ИНН: 10 или 12 цифр отдельным словом (не часть UUID/номера — границы \b и не-дефис).
    (re.compile(r"(?<![\d-])(?:\d{12}|\d{10})(?![\d-])"), "[ИНН]"),
    # ФИО полностью: три слова с заглавной, третье — отчество (-ович/-евич/-ична/-овна/-евна).
    (re.compile(r"\b[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+(?:ович|евич|ич|овна|евна|ична|инична)\b"), "[ФИО]"),
    # Фамилия И.О. / Фамилия И. О.
    (re.compile(r"\b[А-ЯЁ][а-яё]{1,}\s+[А-ЯЁ]\.\s?[А-ЯЁ]\.?"), "[ФИО]"),
]


def mask_sensitive(text: str) -> str:
    """Маскирует ПДн и секреты в строке. Чистая функция — проверяется юнит-тестами."""
    for pattern, repl in _RULES:
        text = pattern.sub(repl, text)
    return text


class PiiMaskingFilter(logging.Filter):
    """Маскирует готовое сообщение записи (msg % args) и текст исключения."""

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            message = record.getMessage()
        except Exception:  # noqa: BLE001 — кривые args не должны ронять логирование
            message = str(record.msg)
        record.msg = mask_sensitive(message)
        record.args = None
        if record.exc_info and not record.exc_text:
            record.exc_text = logging.Formatter().formatException(record.exc_info)
        if record.exc_text:
            record.exc_text = mask_sensitive(record.exc_text)
        return True


class RequestIdFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_var.get() or "-"
        return True


class JsonFormatter(logging.Formatter):
    """Одна строка — один JSON: время UTC, уровень, логгер, request_id, сообщение."""

    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "logger": record.name,
            "request_id": getattr(record, "request_id", "-"),
            "msg": record.getMessage(),
        }
        if record.exc_text:
            payload["exc"] = record.exc_text
        return json.dumps(payload, ensure_ascii=False)


def build_config(level: str = "INFO", fmt: str = "json") -> dict:
    formatter = "json" if fmt.lower() == "json" else "text"
    handler = {
        "class": "logging.StreamHandler",
        "formatter": formatter,
        "filters": ["request_id", "pii"],
    }
    return {
        "version": 1,
        # Не глушим логгеры, созданные до настройки (модули уже импортированы к этому моменту).
        "disable_existing_loggers": False,
        "filters": {
            "request_id": {"()": RequestIdFilter},
            "pii": {"()": PiiMaskingFilter},
        },
        "formatters": {
            "json": {"()": JsonFormatter},
            "text": {"format": "%(asctime)s %(levelname)s [%(request_id)s] %(name)s: %(message)s"},
        },
        "handlers": {"default": handler},
        "root": {"level": level.upper(), "handlers": ["default"]},
        "loggers": {
            # uvicorn ставит свои обработчики — переводим их на общий (маскирование, request_id).
            "uvicorn": {"level": level.upper(), "handlers": ["default"], "propagate": False},
            "uvicorn.error": {"level": level.upper(), "handlers": ["default"], "propagate": False},
            "uvicorn.access": {"level": level.upper(), "handlers": ["default"], "propagate": False},
            "celery": {"level": level.upper(), "handlers": ["default"], "propagate": False},
        },
    }


def setup_logging(level: str | None = None, fmt: str | None = None) -> None:
    from app.infrastructure.config import settings

    logging.config.dictConfig(build_config(level or settings.LOG_LEVEL, fmt or settings.LOG_FORMAT))
