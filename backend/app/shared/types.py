"""
Общие типы/алиасы кросс-домена (ТЗ v13). Только действительно общее и стабильное.
"""
from __future__ import annotations

from typing import NewType
from uuid import UUID

# Явные идентификаторы для читаемости фасадов (не меняют рантайм-тип).
SystemId = NewType("SystemId", UUID)
PeriodId = NewType("PeriodId", UUID)
RiskId = NewType("RiskId", UUID)

# Каноническая метка периода оценки, напр. "2026-Q2".
PeriodLabel = str
