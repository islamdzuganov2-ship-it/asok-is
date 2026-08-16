"""
Pydantic-схемы домена nonconformity (BL-007, RE-14). camelCase-алиасы — единый контракт с фронтом.
Жизненный цикл управляется отдельными действиями (evaluate/decide/assign/execute/verify), а не
свободным PATCH статуса — статусные инварианты держит сервис (§3.3).
"""
from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class _CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)


class NonconformityCreate(_CamelModel):
    system_name: str
    system_id: uuid.UUID | None = None
    characteristic: str
    subcharacteristic: str
    owner: str                         # обязательный владелец (§3.3)
    level: str = "MAJOR"
    evidence_type: str | None = None
    description: str | None = None
    code: str | None = None
    assessment_value_id: uuid.UUID | None = None
    risk_event_id: uuid.UUID | None = None
    is_blocking: bool = False
    is_demo: bool = False


class NonconformityOut(_CamelModel):
    id: uuid.UUID
    code: str | None = None
    system_id: uuid.UUID | None = None
    system_name: str
    characteristic: str
    subcharacteristic: str
    evidence_type: str | None = None
    level: str
    is_blocking: bool
    description: str | None = None
    status: str
    owner: str
    # ТЗ v19 УК-12: FK на пользователя рядом со строкой-снимком (owner). None — не сопоставлено
    # (см. backend/app/scripts/match_owners_to_users.py), а не ошибка данных.
    owner_user_id: uuid.UUID | None = None
    evaluated_ale: float | None = None
    risk_event_id: uuid.UUID | None = None
    proposal_id: uuid.UUID | None = None
    decision_verdict: str | None = None
    acceptance_level: str | None = None
    signed_by: str | None = None
    sla_due: datetime | None = None
    review_date: datetime | None = None
    executed_by: str | None = None
    executed_by_user_id: uuid.UUID | None = None
    executed_at: datetime | None = None
    verified_by: str | None = None
    verified_by_user_id: uuid.UUID | None = None
    verified_at: datetime | None = None
    delta_score_confirmed: float | None = None
    created_by: str | None = None
    created_at: datetime | None = None


# ── Действия жизненного цикла ──
class EvaluateIn(_CamelModel):
    evaluated_ale: float


class DecideIn(_CamelModel):
    verdict: str                       # ELIMINATE / COMPENSATE / ACCEPT
    signed_by: str | None = None       # обязателен для ACCEPT (подпись принятия риска)
    acceptance_level: str | None = None  # если не задан — берётся из матрицы акцепта по ALE


class AssignMeasureIn(_CamelModel):
    proposal_id: uuid.UUID


class ExecuteIn(_CamelModel):
    comment: str | None = None


class VerifyIn(_CamelModel):
    delta_score_confirmed: float | None = None


# ── Воронка замкнутости контура (§5, виджет 6) ──
class FunnelStage(_CamelModel):
    status: str
    count: int


class ClosureFunnelOut(_CamelModel):
    total: int
    verified: int
    closure_rate: float                # % дошедших до «Верифицировано» — анти-KPI аудита ради аудита
    stages: list[FunnelStage]
