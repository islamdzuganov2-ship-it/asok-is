"""Pydantic-схемы домена iam (аутентификация/пользователи), ТЗ v13."""
from typing import Optional

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=100)
    password: str = Field(..., min_length=1, max_length=128)


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    role: str


class TokenRefreshRequest(BaseModel):
    refresh_token: str


class TokenPayload(BaseModel):
    sub: str                        # UUID пользователя
    role: str                       # роль из User.ALL_ROLES
    exp: int                        # unix timestamp истечения
    username: Optional[str] = None  # логин (для человекочитаемого аудита; старые токены — без него)


class UserResponse(BaseModel):
    id: str
    username: str
    role: str
    full_name: Optional[str] = None

    class Config:
        from_attributes = True


class DemoUserCredentials(BaseModel):
    username: str
    password: str
    role: str
