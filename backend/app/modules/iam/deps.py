"""
FastAPI-зависимости домена iam (ТЗ v13): текущий пользователь и контроль ролей (SoD).
Используются роутерами всех доменов через фасад app.modules.iam.
Сессия БД (get_db) — инфраструктура: app.infrastructure.database.
"""
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError

from app.infrastructure.config import settings
from app.modules.iam.security import decode_token

security = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
) -> dict:
    if not credentials or not credentials.credentials:
        if settings.DEMO_MODE:
            return {
                "id": "00000000-0000-0000-0000-000000000001",
                "username": "demo",
                "roles": ["ADMIN"],
            }
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        payload = decode_token(credentials.credentials)
    except (JWTError, KeyError, ValueError) as exc:
        if settings.DEMO_MODE:
            return {
                "id": "00000000-0000-0000-0000-000000000001",
                "username": "demo",
                "roles": ["ADMIN"],
            }
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    return {
        "id": payload.sub,
        "username": payload.sub,
        "roles": [payload.role] if payload.role else [],
    }


def require_role(*allowed_roles: str):
    async def checker(current_user: dict = Depends(get_current_user)) -> dict:
        user_roles = current_user.get("roles", [])
        if not any(role in user_roles for role in allowed_roles):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Required role: {', '.join(allowed_roles)}",
            )
        return current_user

    return checker
