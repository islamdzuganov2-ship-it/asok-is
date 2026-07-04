"""
Домен iam — пользователи, аутентификация (JWT), контроль ролей/SoD (ролевая модель v12).

Публичный фасад (ТЗ v13). Роутер монтируется композиционным корнем из app.modules.iam.router.
Другие домены берут отсюда зависимости контроля доступа (get_current_user/require_role)
и, при необходимости, криптофункции.
"""
from app.modules.iam.deps import get_current_user, require_role
from app.modules.iam.models import User
from app.modules.iam.schemas import (
    DemoUserCredentials,
    LoginRequest,
    TokenPayload,
    TokenRefreshRequest,
    TokenResponse,
    UserResponse,
)
from app.modules.iam.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    get_password_hash,
    verify_password,
)

__all__ = [
    "User",
    "get_current_user",
    "require_role",
    "create_access_token",
    "create_refresh_token",
    "decode_token",
    "get_password_hash",
    "verify_password",
    "LoginRequest",
    "TokenResponse",
    "TokenRefreshRequest",
    "TokenPayload",
    "UserResponse",
    "DemoUserCredentials",
]
