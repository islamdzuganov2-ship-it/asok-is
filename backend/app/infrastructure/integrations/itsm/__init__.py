"""
Адаптер ITSM — реализация порта shared.ports.IncidentSource (ТЗ v13 §B5, фаза 4).

Приём инцидентов/проблем/изменений → метрики доступности, MTTR, плотности дефектов.
"""
from __future__ import annotations

import logging
from typing import Sequence

from app.infrastructure.config import settings
from app.shared.ports import IncidentRecord, IncidentSource

logger = logging.getLogger(__name__)


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
