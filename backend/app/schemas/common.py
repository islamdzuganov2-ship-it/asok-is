# backend/app/schemas/common.py — СОЗДАТЬ новый файл
from pydantic import BaseModel, Field
from typing import Generic, TypeVar, List

T = TypeVar('T')

class PaginatedResponse(BaseModel, Generic[T]):
    """Универсальная схема пагинированного ответа"""
    items: List[T]
    total: int
    page: int = Field(default=1, ge=1)
    limit: int = Field(default=50, ge=1, le=100)
    
    @property
    def pages(self) -> int:
        return (self.total + self.limit - 1) // self.limit