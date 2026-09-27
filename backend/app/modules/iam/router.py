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
from app.modules.iam.deps import get_current_user_changing_password, security
from app.modules.iam.password_policy import RULES, PasswordPolicyError
from app.modules.iam.schemas import LoginRequest, LogoutRequest, PasswordChangeRequest, TokenRefreshRequest
from app.modules.iam.security import decode_token

router = APIRouter()

_UNAUTHORIZED = {"WWW-Authenticate": "Bearer"}


@router.post("/login")
async def login(
    payload: LoginRequest,
    db: AsyncSession = Depends(get_db),
) -> dict:
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
async def refresh_token(payload: TokenRefreshRequest, db: AsyncSession = Depends(get_db)) -> dict:
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
    # Выход доступен и с неснятым временным паролем (ИБ-11).
    _: dict = Depends(get_current_user_changing_password),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Серверный выход (ИБ-12): текущий access и вся сессия (с её refresh) отзываются."""
    try:
        access = decode_token(credentials.credentials, expected_type="access")
    except (JWTError, KeyError, ValueError, AttributeError) as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, headers=_UNAUTHORIZED) from exc
    await auth_service.logout(db, access, payload.refresh_token if payload else None)


@router.get("/password-policy")
async def password_policy() -> dict[str, list[str]]:
    """Требования к паролю (ИБ-11) — для подсказки на экранах смены и выдачи пароля."""
    return {"rules": list(RULES)}


@router.post("/change-password")
async def change_password(
    payload: PasswordChangeRequest,
    current: dict = Depends(get_current_user_changing_password),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Смена собственного пароля (ИБ-11): обязательная после временного пароля или по желанию.
    Ответ — новая пара токенов; все прежние сессии пользователя закрыты."""
    try:
        return await auth_service.change_password(db, current, payload.current_password, payload.new_password)
    except auth_service.LoginLocked as exc:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Слишком много неудачных попыток. Повторите позже.",
            headers={"Retry-After": str(max(1, exc.retry_after))},
        ) from exc
    except auth_service.WrongCurrentPassword as exc:
        # 400, а не 401: 401 фронт трактует как истёкшую сессию и выкидывает на вход.
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Текущий пароль указан неверно") from exc
    except auth_service.PasswordNotChangeable as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="Пароль встроенной демо-учётки не меняется") from exc
    except PasswordPolicyError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
