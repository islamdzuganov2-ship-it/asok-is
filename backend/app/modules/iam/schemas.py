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


# ── Администрирование (BL-008): пользователи и матрица прав ──────────────────────
class UserAdminOut(BaseModel):
    id: str
    username: str
    email: Optional[str] = None
    full_name: Optional[str] = None
    role: str
    is_active: bool


class UserCreateIn(BaseModel):
    username: str = Field(..., min_length=1, max_length=100)
    password: str = Field(..., min_length=6, max_length=128)
    email: Optional[str] = Field(default=None, max_length=255)
    full_name: Optional[str] = Field(default=None, max_length=255)
    role: str


class UserUpdateIn(BaseModel):
    full_name: Optional[str] = Field(default=None, max_length=255)
    role: Optional[str] = None
    is_active: Optional[bool] = None


class PasswordResetIn(BaseModel):
    password: str = Field(..., min_length=6, max_length=128)


class PermissionOut(BaseModel):
    key: str
    group: str
    label: str
    description: str = ""


class PermissionCatalogOut(BaseModel):
    groups: list[str]
    permissions: list[PermissionOut]
    roles: list[str]


class RolePermsIn(BaseModel):
    permissions: list[str]


class MePermissionsOut(BaseModel):
    role: str
    permissions: list[str]
