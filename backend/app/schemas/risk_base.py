"""Pydantic-схемы базы рисков (risk_base)."""
from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class RiskBaseCreate(BaseModel):
    code: str = Field(..., max_length=64)
    title: str
    category: str
    characteristic: str | None = None
    subcharacteristic: str | None = None
    description: str
    consequence: str | None = None
    mitigation: str | None = None
    severity: str = "medium"
    likelihood: str = "medium"
    triggers: str | None = None
    keywords: str | None = None
    source: str = "manual"
    system_id: UUID | None = None


class RiskBaseUpdate(BaseModel):
    title: str | None = None
    category: str | None = None
    characteristic: str | None = None
    subcharacteristic: str | None = None
    description: str | None = None
    consequence: str | None = None
    mitigation: str | None = None
    severity: str | None = None
    likelihood: str | None = None
    triggers: str | None = None
    keywords: str | None = None
    status: str | None = None


class RiskBaseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    code: str
    title: str
    category: str
    characteristic: str | None = None
    subcharacteristic: str | None = None
    description: str
    consequence: str | None = None
    mitigation: str | None = None
    severity: str
    likelihood: str
    triggers: str | None = None
    keywords: str | None = None
    source: str
    system_id: UUID | None = None
    status: str
    created_by: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
