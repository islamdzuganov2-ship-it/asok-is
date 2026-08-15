"""
FastAPI-зависимости домена iam (ТЗ v13): текущий пользователь и контроль ролей (SoD).
Используются роутерами всех доменов через фасад app.modules.iam.
Сессия БД (get_db) — инфраструктура: app.infrastructure.database.
"""
import logging

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.config import settings
from app.infrastructure.database import get_db
from app.modules.iam.permissions_service import get_role_permissions
from app.modules.iam.security import decode_token

logger = logging.getLogger(__name__)

security = HTTPBearer(auto_error=False)

DEMO_USER = {
    "id": "00000000-0000-0000-0000-000000000001",
    "username": "demo",
    "roles": ["ADMIN"],
}


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
) -> dict:
    """Текущий пользователь из bearer-токена.

    Обход аутентификации (ДЕФ-02) допускается ТОЛЬКО при `DEMO_AUTH_BYPASS=true` и ТОЛЬКО
    для запроса без заголовка Authorization. Невалидный или просроченный токен — всегда 401,
    в любом режиме: иначе подделанная подпись молча повышалась бы до ADMIN, а фронт не видел
    бы 401 и не отправлял пользователя на релогин.
    """
    if not credentials or not credentials.credentials:
        if settings.DEMO_AUTH_BYPASS:
            logger.warning(
                "DEMO_AUTH_BYPASS: запрос без токена обслужен как %s (роль %s)",
                DEMO_USER["username"], DEMO_USER["roles"][0],
            )
            return dict(DEMO_USER)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        payload = decode_token(credentials.credentials)
    except (JWTError, KeyError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    return {
        "id": payload.sub,
        # Человекочитаемый логин для аудита (created_by/decided_by); старые токены без
        # username → fallback на sub (UUID), новые (после релогина) — реальный логин.
        "username": payload.username or payload.sub,
        "roles": [payload.role] if payload.role else [],
    }


def require_role(*allowed_roles: str):
    """DEPRECATED (BL-008): статическая проверка по ролям. Оставлена как обёртка на время
    миграции call-site'ов на require_permission; новые эндпоинты используют require_permission."""
    async def checker(current_user: dict = Depends(get_current_user)) -> dict:
        user_roles = current_user.get("roles", [])
        if not any(role in user_roles for role in allowed_roles):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Required role: {', '.join(allowed_roles)}",
            )
        return current_user

    return checker


def require_permission(*required: str):
    """Контроль доступа по правам (BL-008 RBAC). Пропускает, если у роли пользователя есть
    ХОТЯ БЫ ОДНО из перечисленных прав (обычно передаётся одно). Права резолвятся из матрицы
    role_permissions с кэшем; SUPER_ADMIN всегда проходит."""
    async def checker(
        current_user: dict = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ) -> dict:
        roles = current_user.get("roles", [])
        role = roles[0] if roles else ""
        granted = await get_role_permissions(db, role)
        if not any(perm in granted for perm in required):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Missing permission: {', '.join(required)}",
            )
        return current_user

    return checker
