"""
Адаптер синхронизации задач — реализация shared.ports.TaskSyncPort (ТЗ v19 п.6, УК-06).

Решение сессии: интеграция с внешним таск-трекером (Jira/СУЗ и т.п.) НЕ выполняется сейчас —
внутренний Гант (TaskPlanDashboard.tsx поверх governance.Proposal) уже закрывает текущую
потребность в планировании и контроле. StubTaskSyncPort — контракт на будущее: push_task
ничего никуда не отправляет и возвращает локальный маркер (не выдуманный внешний ID),
fetch_status всегда честно отвечает «не синхронизировано». Реальный клиент подключается сюда
же по конфигурации (TASK_SYNC_API_URL), домены не меняются — тот же приём, что у kms/tms/itsm.
"""
from __future__ import annotations

import logging

from app.infrastructure.config import settings
from app.shared.ports import ExternalTask, TaskSyncPort

logger = logging.getLogger(__name__)


class StubTaskSyncPort:
    """Заглушка синхронизации: push_task не отправляет ничего вовне, fetch_status не находит
    ничего вовне. Держит контур рабочим и честным (не выдуманные внешние ID/статусы) без
    настроенного трекера."""

    def push_task(self, entity_type: str, entity_id: str, title: str,
                  assignee: str | None, due_date: str | None) -> str:
        logger.info(
            "TaskSync stub push_task(%s#%s %r, исполнитель=%r, срок=%r) — интеграция не "
            "настроена, задача НЕ отправлена вовне",
            entity_type, entity_id, title, assignee, due_date,
        )
        return f"stub://not-synced/{entity_type}/{entity_id}"

    def fetch_status(self, external_id: str) -> ExternalTask | None:
        logger.debug("TaskSync stub fetch_status(%r) — интеграция не настроена", external_id)
        return None


def get_task_sync_port() -> TaskSyncPort:
    """Фабрика адаптера синхронизации задач: пока трекер не настроен — заглушка."""
    if settings.TASK_SYNC_API_URL:
        logger.warning(
            "TASK_SYNC_API_URL задан (%s), но адаптер ещё не реализован — используется заглушка",
            settings.TASK_SYNC_API_URL,
        )
    return StubTaskSyncPort()
