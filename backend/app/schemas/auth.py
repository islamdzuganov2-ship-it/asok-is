# backend/app/schemas/auth.py
"""
Pydantic схемы для аутентификации и авторизации
"""
from pydantic import BaseModel, Field, field_validator
from typing import Optional, List
import re

class LoginRequest(BaseModel):
    """Схема запроса на вход"""
    username: str = Field(..., min_length=3, max_length=50, description="Имя пользователя")
    password: str = Field(..., min_length=8, max_length=128, description="Пароль")

class TokenResponse(BaseModel):
    """Схема ответа с токенами"""
    access_token: str = Field(..., description="JWT access токен")
    refresh_token: Optional[str] = Field(None, description="JWT refresh токен")
    token_type: str = Field(default="bearer", description="Тип токена")
    expires_in: int = Field(default=900, description="Время жизни токена в секундах")

class TokenRefreshRequest(BaseModel):
    """Схема запроса на обновление токена"""
    refresh_token: str = Field(..., description="Refresh токен")

class UserResponse(BaseModel):
    """Схема ответа с данными пользователя"""
    id: str = Field(..., description="ID пользователя")
    username: str = Field(..., description="Имя пользователя")
    roles: List[str] = Field(default_factory=list, description="Роли пользователя")
    is_active: bool = Field(default=True, description="Статус активности")

    model_config = {
        "json_schema_extra": {
            "example": {
                "id": "550e8400-e29b-41d4-a716-446655440000",
                "username": "demo_manager",
                "roles": ["QUALITY_MANAGER", "TEST_ANALYST"],
                "is_active": True
            }
        }
    }

class DemoUserCredentials(BaseModel):
    """Схема для демо-пользователей (только development)"""
    username: str
    password: str
    role: str
    
    @field_validator('role')
    @classmethod
    def validate_role(cls, v: str) -> str:
        allowed = {"ADMIN", "QUALITY_MANAGER", "TEST_ANALYST", "VIEWER"}
        if v not in allowed:
            raise ValueError(f"Роль должна быть одной из: {allowed}")
        return v