"""
REST API домена iam — аутентификация (ТЗ v13): /login, /refresh, /logout.

Логика — в auth_service (анти-брутфорс ИБ-10, сессии ИБ-12, журнал ИБ-08); здесь только
перевод исключений в HTTP.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials
from jose import JWTError
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.database import get_db
from app.modules.iam import auth_service
from app.modules.iam.auth_service import DEMO_USERS  # noqa: F401 — обратная совместимость импорта
from app.modules.iam.deps import get_current_user, security
from app.modules.iam.schemas import LoginRequest, LogoutRequest, TokenRefreshRequest
from app.modules.iam.security import decode_token

router = APIRouter()

_UNAUTHORIZED = {"WWW-Authenticate": "Bearer"}


@router.post("/login")
async def login(
    payload: LoginRequest,
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    try:
        return await auth_service.login(db, payload.username, payload.password)
    except auth_service.LoginLocked as exc:
        # 429 + Retry-After (ИБ-10): клиент видит, сколько ждать; пароль при блокировке не
        # проверяется вовсе — ответ не выдаёт, угадан ли он.
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Слишком много неудачных попыток входа. Повторите позже.",
            headers={"Retry-After": str(max(1, exc.retry_after))},
        ) from exc
    except auth_service.InvalidCredentials as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials", headers=_UNAUTHORIZED,
        ) from exc


@router.post("/refresh")
async def refresh_token(payload: TokenRefreshRequest, db: AsyncSession = Depends(get_db)) -> dict[str, str]:
    try:
        return await auth_service.refresh(db, payload.refresh_token)
    except auth_service.RefreshDenied as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token",
            headers=_UNAUTHORIZED,
        ) from exc


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    payload: LogoutRequest | None = None,
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    _: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Серверный выход (ИБ-12): текущий access и вся сессия (с её refresh) отзываются."""
    try:
        access = decode_token(credentials.credentials, expected_type="access")
    except (JWTError, KeyError, ValueError, AttributeError) as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, headers=_UNAUTHORIZED) from exc
    await auth_service.logout(db, access, payload.refresh_token if payload else None)
