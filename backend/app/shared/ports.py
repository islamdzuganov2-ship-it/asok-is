"""
Порты внешних интеграций (ТЗ v13, §B5) — КОНТРАКТЫ без реализации.

Домены зависят от этих протоколов, а не от конкретных клиентов (инверсия зависимостей).
Реализации-адаптеры живут в app.infrastructure.integrations.{kms,tms,itsm,dwh} (фаза 4).
Использование typing.Protocol позволяет подменять адаптеры моками в тестах домена.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol, Sequence, runtime_checkable


# ─── СУЗ (KMS): система управления знаниями ──────────────────────────────────────
@dataclass(frozen=True)
class KnowledgeArticle:
    external_id: str
    title: str
    body: str
    url: str | None = None


@runtime_checkable
class KnowledgeSource(Protocol):
    """Приём статей/регламентов как grounding-контекста для LLM и публикация заключений."""

    def search(self, query: str, limit: int = 5) -> Sequence[KnowledgeArticle]: ...

    def publish(self, title: str, body: str, tags: Sequence[str] = ()) -> str: ...


# ─── ТМС (TMS): управление тестированием ─────────────────────────────────────────
@dataclass(frozen=True)
class TestRunResult:
    external_id: str
    system_code: str
    passed: int
    failed: int
    coverage_pct: float | None = None


@runtime_checkable
class TestManagementSource(Protocol):
    """Результаты тестов/покрытие → метрики надёжности и тестируемости (ISO 25010)."""

    def fetch_results(self, system_code: str, period: str) -> Sequence[TestRunResult]: ...


# ─── ITSM: управление инцидентами/проблемами/изменениями ─────────────────────────
@dataclass(frozen=True)
class IncidentRecord:
    external_id: str
    system_code: str
    severity: str
    opened_at: str
    resolved_at: str | None = None


@runtime_checkable
class IncidentSource(Protocol):
    """Инциденты/проблемы → метрики доступности, MTTR, плотности дефектов."""

    def fetch_incidents(self, system_code: str, period: str) -> Sequence[IncidentRecord]: ...


# ─── DWH: хранилище данных (приём сырья + выгрузка анализа) ───────────────────────
@runtime_checkable
class DataWarehouseSource(Protocol):
    """Приём сырых данных для оценок из витрин хранилища."""

    def read_dataset(self, name: str, params: dict[str, Any] | None = None) -> Sequence[dict[str, Any]]: ...


@runtime_checkable
class DataWarehouseSink(Protocol):
    """ВЫГРУЗКА рассчитанного анализа/дашбордов/заключений АСОК ИС обратно в хранилище."""

    def write_analytics(self, dataset: str, rows: Sequence[dict[str, Any]]) -> int: ...


# ─── Уведомления (ТЗ v19 п.6): доставка вовне — канал НЕ выбран заказчиком ────────
# Решение сессии (docs/ТЗ_19 §4): SMTP/мессенджер не определены — строим порт и заглушку,
# домены эмитят события ЭТОГО контракта уже сейчас (см. shared/notification_events.py — каталог
# типов), реальный канал подключается адаптером без изменений в доменах.
@dataclass(frozen=True)
class NotificationEvent:
    """Одно событие, о котором нужно оповестить получателя — не привязано к каналу доставки."""
    event_type: str    # см. shared.notification_events — каталог типов, не строка на месте
    recipient: str      # ФИО/логин получателя (адрес почты пока не у всех пользователей есть)
    subject: str
    body: str
    entity_type: str    # "proposal" | "nonconformity" — на что ссылается событие
    entity_id: str


@runtime_checkable
class NotificationPort(Protocol):
    """Доставка одного события получателю. Канал (email/мессенджер/ITSM) решает адаптер."""

    def notify(self, event: NotificationEvent) -> bool: ...


# ─── Синхронизация задач (ТЗ v19 п.6): интеграция с внешним таск-трекером — НЕ сейчас ──
# Решение сессии (docs/ТЗ_19 §4): не интегрировать сейчас — внутренний Гант (TaskPlanDashboard.tsx
# поверх governance.Proposal) уже закрывает планирование задач. Контракт готов заранее, чтобы
# подключение внешнего трекера (Jira/СUЗ и т.п.) не требовало правок в доменах.
@dataclass(frozen=True)
class ExternalTask:
    external_id: str
    title: str
    status: str
    assignee: str | None = None
    due_date: str | None = None


@runtime_checkable
class TaskSyncPort(Protocol):
    """Двусторонняя синхронизация мер/поручений с внешним таск-трекером."""

    def push_task(self, entity_type: str, entity_id: str, title: str,
                  assignee: str | None, due_date: str | None) -> str: ...  # → внешний ID

    def fetch_status(self, external_id: str) -> ExternalTask | None: ...
