"""
Адаптер ITSM — реализация порта shared.ports.IncidentSource (ТЗ v13 §B5; BL-007 RE-23).

Живого подключения к ITSM нет (пилот идёт от ручного ввода, §0.5 ТЗ контура). Задел RE-23 —
файловый адаптер: выгрузка тикетов из ITSM в CSV или JSON (так её отдают почти все системы
класса ServiceNow/Naumen/Jira SM без интеграционного контура). Контракт данных §2.6 — имена
колонок ниже; другие имена сопоставляются через `field_map`.

HTTP-адаптер под конкретный ITSM подключается сюда же по `ITSM_API_URL`, домены не меняются.
"""
from __future__ import annotations

import csv
import io
import json
import logging
from typing import Iterable, Sequence

from app.infrastructure.config import settings
from app.shared.ports import IncidentRecord, IncidentSource

logger = logging.getLogger(__name__)

# Контракт выгрузки (§2.6): каноническое имя поля → синонимы, встречающиеся в выгрузках ITSM.
DEFAULT_FIELD_MAP: dict[str, tuple[str, ...]] = {
    "external_id": ("number", "id", "ticket", "номер"),
    "opened_at": ("opened_at", "created", "opened", "открыт"),
    "resolved_at": ("resolved_at", "resolved", "closed_at", "восстановлен"),
    "severity": ("priority", "severity", "приоритет"),
    "title": ("short_description", "title", "summary", "описание"),
    "assignment_group": ("assignment_group", "group", "группа"),
    "ci_name": ("cmdb_ci", "ci", "service", "система"),
    "category": ("category", "категория"),
    "parent_ref": ("parent", "parent_incident", "родитель"),
    "reassignments": ("reassignments", "reassignment_log", "переназначения"),
}
REQUIRED_FIELDS = ("external_id", "opened_at")
# Поля, от заполненности которых зависит экономика сбоя: аудит качества выгрузки (RE-23).
AUDITED_FIELDS = ("external_id", "opened_at", "resolved_at", "severity", "title",
                  "assignment_group", "ci_name", "reassignments")


def _pick(row: dict, names: Iterable[str]) -> object:
    lower = {str(k).strip().lower(): v for k, v in row.items()}
    for n in names:
        v = lower.get(n.lower())
        if v not in (None, ""):
            return v
    return None


def _reassignments(raw: object) -> tuple[tuple[str, str], ...]:
    """Журнал переназначений: JSON-список [{at, to}] или строка «момент>линия; момент>линия»."""
    if raw in (None, ""):
        return ()
    items: list[tuple[str, str]] = []
    if isinstance(raw, list):
        for e in raw:
            if isinstance(e, dict) and e.get("at") and e.get("to"):
                items.append((str(e["at"]), str(e["to"])))
        return tuple(items)
    text = str(raw)
    try:
        parsed = json.loads(text)
        if isinstance(parsed, list):
            return _reassignments(parsed)
    except ValueError:
        pass
    for chunk in text.split(";"):
        if ">" in chunk:
            at, to = chunk.split(">", 1)
            if at.strip() and to.strip():
                items.append((at.strip(), to.strip()))
    return tuple(items)


def parse_export(content: bytes | str, fmt: str = "csv",
                 field_map: dict[str, tuple[str, ...]] | None = None) -> list[dict]:
    """Выгрузка → список словарей с каноническими ключами (без отбраковки — её делает аудит)."""
    fm = {**DEFAULT_FIELD_MAP, **(field_map or {})}
    text = content.decode("utf-8-sig") if isinstance(content, bytes) else content
    if fmt == "json":
        data = json.loads(text)
        rows = data if isinstance(data, list) else data.get("items", [])
    else:
        sample = text[:2048]
        delimiter = ";" if sample.count(";") > sample.count(",") else ","
        rows = list(csv.DictReader(io.StringIO(text), delimiter=delimiter))
    out: list[dict] = []
    for row in rows:
        rec = {key: _pick(row, names) for key, names in fm.items()}
        rec["reassignments"] = _reassignments(rec.get("reassignments"))
        out.append(rec)
    return out


def to_record(rec: dict) -> IncidentRecord | None:
    """Канонический словарь → IncidentRecord порта. None — без обязательных полей."""
    if any(rec.get(f) in (None, "") for f in REQUIRED_FIELDS):
        return None
    return IncidentRecord(
        external_id=str(rec["external_id"]),
        system_code=str(rec.get("ci_name") or rec.get("assignment_group") or ""),
        severity=str(rec.get("severity") or "medium"),
        opened_at=str(rec["opened_at"]),
        resolved_at=str(rec["resolved_at"]) if rec.get("resolved_at") else None,
        title=str(rec["title"]) if rec.get("title") else None,
        assignment_group=str(rec["assignment_group"]) if rec.get("assignment_group") else None,
        ci_name=str(rec["ci_name"]) if rec.get("ci_name") else None,
        category=str(rec["category"]) if rec.get("category") else None,
        parent_ref=str(rec["parent_ref"]) if rec.get("parent_ref") else None,
        reassignments=tuple(rec.get("reassignments") or ()),
    )


def audit_quality(rows: Sequence[dict]) -> dict:
    """Аудит качества полей выгрузки (RE-23, §2.6): доля заполненности каждого поля экономики.

    Цифра нужна ДО загрузки: выгрузка, где у 60% тикетов нет времени восстановления, даст
    заниженную стоимость простоя, и это должно быть видно, а не «тихо посчитано».
    """
    total = len(rows)
    filled = {f: sum(1 for r in rows if r.get(f) not in (None, "", ())) for f in AUDITED_FIELDS}
    return {
        "total": total,
        "rejected_missing_required": sum(1 for r in rows if to_record(r) is None),
        "completeness_pct": {f: (round(filled[f] / total * 100, 1) if total else 0.0) for f in AUDITED_FIELDS},
    }


class FileIncidentSource:
    """Порт IncidentSource поверх файла выгрузки ITSM (задел RE-23)."""

    def __init__(self, content: bytes | str, fmt: str = "csv",
                 field_map: dict[str, tuple[str, ...]] | None = None) -> None:
        self.rows = parse_export(content, fmt, field_map)
        self.records = [r for r in (to_record(x) for x in self.rows) if r is not None]

    def fetch_incidents(self, system_code: str, period: str) -> Sequence[IncidentRecord]:
        """Фильтр по ИС (CI/группа) и периоду-префиксу даты открытия (`2026`, `2026-09`)."""
        code = (system_code or "").strip().lower()
        return [
            r for r in self.records
            if (not code or code in {(r.ci_name or "").lower(), (r.assignment_group or "").lower(), r.system_code.lower()})
            and (not period or r.opened_at.startswith(period))
        ]


class StubIncidentSource:
    """Заглушка ITSM: пустые инциденты, пока ITSM_API_URL не настроен."""

    def fetch_incidents(self, system_code: str, period: str) -> Sequence[IncidentRecord]:
        logger.debug("ITSM stub fetch_incidents(%s, %s) — интеграция не настроена", system_code, period)
        return []


def get_incident_source() -> IncidentSource:
    if settings.ITSM_API_URL:
        logger.warning("ITSM_API_URL задан (%s), но HTTP-адаптер ещё не реализован — используется заглушка",
                       settings.ITSM_API_URL)
    return StubIncidentSource()
