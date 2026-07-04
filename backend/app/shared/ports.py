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
