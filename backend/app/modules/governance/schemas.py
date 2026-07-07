"""
Pydantic-схемы домена governance (T-10). camelCase-алиасы — чтобы фронтовый контракт `Proposal`
(governanceSlice.ts) не менялся при переходе с localStorage на API.

Поля-подписи (`decidedBy`, `executedBy`, `createdBy`, `escalationDecidedBy`) на входе НЕ
принимаются — они проставляются на сервере из токена (нельзя подделать «кто решил/выполнил»).
"""
from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class _CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)


class ProposalChange(_CamelModel):
    at: str
    by: str
    field: str
    from_: str | None = None
    to: str | None = None
    model_config = ConfigDict(
        alias_generator=to_camel, populate_by_name=True, from_attributes=True,
        # поле называется from_ (from — ключевое слово), но наружу/внутрь — «from»
    )


class ProposalOut(_CamelModel):
    id: uuid.UUID
    system_id: uuid.UUID | None = None
    system_name: str
    characteristic: str | None = None
    metric_name: str | None = None
    calculated_score: float | None = None
    calculated_level: str | None = None
    adjusted_level: str | None = None
    rationale: str | None = None
    expectation: str | None = None
    create_risk: bool = False
    risk_title: str | None = None
    owner: str | None = None
    owner_role: str | None = None
    due_date: str | None = None
    status: str
    decided_by: str | None = None
    decided_at: datetime | None = None
    decision_comment: str | None = None
    execution: str | None = None
    execution_comment: str | None = None
    executed_by: str | None = None
    executed_at: datetime | None = None
    suz_link: str | None = None
    top_comment: str | None = None
    escalated: bool = False
    escalation_reason: str | None = None
    escalation_decision: str | None = None
    escalation_decision_comment: str | None = None
    escalation_decided_by: str | None = None
    history: list | None = None
    is_demo: bool = False
    created_by: str | None = None
    created_at: datetime | None = None


class ProposalCreate(_CamelModel):
    system_name: str
    characteristic: str | None = None
    metric_name: str | None = None
    calculated_score: float | None = None
    calculated_level: str | None = None
    adjusted_level: str | None = None
    rationale: str | None = None
    expectation: str | None = None
    create_risk: bool = False
    risk_title: str | None = None
    owner: str | None = None
    owner_role: str | None = None
    due_date: str | None = None
    is_demo: bool = False


class DecisionIn(_CamelModel):
    comment: str | None = None


class MetaIn(_CamelModel):
    owner: str | None = None
    owner_role: str | None = None
    due_date: str | None = None


class EditIn(_CamelModel):
    """Правка меры топ-менеджментом — поля пишутся в историю (аудит)."""
    risk_title: str | None = None
    rationale: str | None = None
    expectation: str | None = None
    owner: str | None = None
    owner_role: str | None = None
    due_date: str | None = None
    top_comment: str | None = None


class ExecutionIn(_CamelModel):
    status: str  # DONE / NOT_DONE
    comment: str


class TaskUpdateIn(_CamelModel):
    suz_link: str | None = None
    top_comment: str | None = None
    owner: str | None = None
    owner_role: str | None = None
    due_date: str | None = None


class EscalateIn(_CamelModel):
    reason: str


class EscalationDecisionIn(_CamelModel):
    decision: str  # IGNORE / REQUEST_MEASURES
    comment: str
