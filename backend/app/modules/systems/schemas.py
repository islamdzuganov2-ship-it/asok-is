"""Pydantic-схемы домена systems (реестр ИС), ТЗ v13."""
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class SystemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True, use_enum_values=True)

    id: UUID
    name: str
    code: Optional[str] = None
    status_lc: str
    criticality_class: str
    # CLASSIC → контур ISO 25010; AI → контур ГОСТ Р 59898-2021 (BL-001).
    system_kind: str = "CLASSIC"
    is_active: bool


class SystemsListResponse(BaseModel):
    items: list[SystemResponse]
    total: int
    page: int
    limit: int


class SystemCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    code: str | None = Field(None, max_length=50)
    status_lc: str = "ОЭ"
    criticality_class: str
    system_kind: str = Field("CLASSIC", pattern="^(CLASSIC|AI)$")
    owner: str | None = Field(None, max_length=255)
    is_active: bool = True
