"""Pydantic-схемы домена iam (аутентификация/пользователи), ТЗ v13."""
from typing import Optional

from pydantic import BaseModel, Field, field_validator


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
    # ИБ-12: идентификаторы для отзыва. Токены, выданные до ИБ-12, этих полей не несут —
    # они доживают свой TTL (отзыв по пользователю к ним применяется по exp, см. sessions.py).
    jti: Optional[str] = None       # идентификатор токена
    sid: Optional[str] = None       # сессия (вход): общая для access и цепочки refresh
    iat: Optional[float] = None     # время выдачи, unix (с миллисекундами)
    type: Optional[str] = None      # access | refresh


class LogoutRequest(BaseModel):
    """Необязательный refresh-токен: если передан — отзывается и он (иначе его сессия всё равно
    закрывается по sid текущего access-токена)."""
    refresh_token: Optional[str] = None


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


class AuditEventOut(BaseModel):
    """Событие журнала ИБ (ИБ-08) для раздела администрирования."""
    id: str
    created_at: str
    user_id: Optional[str] = None
    username: Optional[str] = None
    action: Optional[str] = None
    outcome: Optional[str] = None
    entity_type: Optional[str] = None
    entity_id: Optional[str] = None
    entity_key: Optional[str] = None
    old_values: Optional[dict] = None
    new_values: Optional[dict] = None
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None
    request_id: Optional[str] = None

    @field_validator("id", "created_at", "user_id", "entity_id", "ip_address", mode="before")
    @classmethod
    def _to_str(cls, v):
        if v is None:
            return None
        return v.isoformat() if hasattr(v, "isoformat") else str(v)


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


class PreferencesOut(BaseModel):
    prefs: dict


class PreferencesIn(BaseModel):
    prefs: dict


class MandatorySectionsOut(BaseModel):
    permissions: list[str]


class MandatorySectionsIn(BaseModel):
    permissions: list[str]
