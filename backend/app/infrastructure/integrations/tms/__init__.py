"""
Адаптер ТМС — реализация порта shared.ports.TestManagementSource (ТЗ v13 §B5, фаза 4).

Приём результатов тестов/покрытия → метрики надёжности и тестируемости (ISO 25010).
"""
from __future__ import annotations

import logging
from typing import Sequence

from app.infrastructure.config import settings
from app.shared.ports import TestManagementSource, TestRunResult

logger = logging.getLogger(__name__)


class StubTestManagementSource:
    """Заглушка ТМС: пустые результаты, пока TMS_API_URL не настроен."""

    def fetch_results(self, system_code: str, period: str) -> Sequence[TestRunResult]:
        logger.debug("TMS stub fetch_results(%s, %s) — интеграция не настроена", system_code, period)
        return []


def get_test_management_source() -> TestManagementSource:
    if settings.TMS_API_URL:
        logger.warning("TMS_API_URL задан (%s), но HTTP-адаптер ещё не реализован — используется заглушка",
                       settings.TMS_API_URL)
    return StubTestManagementSource()
