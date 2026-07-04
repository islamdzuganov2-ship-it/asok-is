"""
Адаптер DWH (хранилище данных) — порты shared.ports.DataWarehouseSource/Sink (ТЗ v13 §B5, фаза 4).

Два направления:
  Source — ПРИЁМ сырых данных из витрин для оценок;
  Sink   — ВЫГРУЗКА рассчитанного анализа (оценки, дашборды, LLM-заключения) в витрины АСОК ИС.
Принципы: идемпотентная запись (upsert по внешнему ключу), деградация при недоступности.
"""
from __future__ import annotations

import logging
from typing import Any, Sequence

from app.infrastructure.config import settings
from app.shared.ports import DataWarehouseSink, DataWarehouseSource

logger = logging.getLogger(__name__)


class StubDataWarehouse:
    """Заглушка DWH: пустое чтение, запись в лог, пока DWH_URL не настроен."""

    def read_dataset(self, name: str, params: dict[str, Any] | None = None) -> Sequence[dict[str, Any]]:
        logger.debug("DWH stub read_dataset(%s) — интеграция не настроена", name)
        return []

    def write_analytics(self, dataset: str, rows: Sequence[dict[str, Any]]) -> int:
        logger.info("DWH stub write_analytics(%s): %d строк — интеграция не настроена, выгрузка пропущена",
                    dataset, len(rows))
        return 0


def get_dwh_source() -> DataWarehouseSource:
    if settings.DWH_URL:
        logger.warning("DWH_URL задан (%s), но адаптер ещё не реализован — используется заглушка", settings.DWH_URL)
    return StubDataWarehouse()


def get_dwh_sink() -> DataWarehouseSink:
    if settings.DWH_URL:
        logger.warning("DWH_URL задан (%s), но адаптер ещё не реализован — используется заглушка", settings.DWH_URL)
    return StubDataWarehouse()
