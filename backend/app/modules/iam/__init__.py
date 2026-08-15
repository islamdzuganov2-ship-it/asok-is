"""
Домен iam — пользователи, аутентификация (JWT), контроль ролей/SoD (ролевая модель v12).

Публичный фасад (ТЗ v13). Роутер монтируется композиционным корнем из app.modules.iam.router.
Другие домены берут отсюда зависимости контроля доступа (get_current_user/require_role)
и, при необходимости, криптофункции.
"""
from app.modules.iam.deps import get_current_user, require_permission, require_role
from app.modules.iam.identity import resolve_user_id
from app.modules.iam.models import RolePermission, User
from app.modules.iam.permissions import PERMISSIONS, Permission
from app.modules.iam.permissions_service import (
    get_matrix,
    get_role_permissions,
    seed_rbac_defaults,
    set_role_permissions,
)
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
    "RolePermission",
    "resolve_user_id",
    "get_current_user",
    "require_role",
    "require_permission",
    "Permission",
    "PERMISSIONS",
    "get_role_permissions",
    "get_matrix",
    "set_role_permissions",
    "seed_rbac_defaults",
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
