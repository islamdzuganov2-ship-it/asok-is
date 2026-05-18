import uuid
from datetime import datetime
from typing import Literal
from pydantic import BaseModel, Field, ConfigDict

StatusLC = Literal["ОЭ", "ПЭ", "Создание и тестирование"]
CriticalityClass = Literal["MISSION CRITICAL", "BUSINESS CRITICAL", "BUSINESS OPERATIONAL"]

class SystemBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    code: str | None = Field(None, max_length=50)
    status_lc: StatusLC
    criticality_class: CriticalityClass
    owner: str | None = Field(None, max_length=255)
    is_active: bool = True

class SystemCreate(SystemBase):
    pass

class SystemUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=255)
    status_lc: StatusLC | None = None
    criticality_class: CriticalityClass | None = None
    owner: str | None = None
    is_active: bool | None = None

class SystemRead(SystemBase):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime

class SystemListResponse(BaseModel):
    items: list[SystemRead]
    total: int
    page: int
    page_size: int