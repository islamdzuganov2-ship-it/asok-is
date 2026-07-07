"""
REST API домена iam — аутентификация (ТЗ v13): /login, /refresh.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.config import settings
from app.infrastructure.database import get_db
from app.modules.iam.models import User
from app.modules.iam.schemas import LoginRequest, TokenRefreshRequest
from app.modules.iam.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    verify_password,
)

router = APIRouter()

DEMO_USERS = {
    "admin": {
        "id": "00000000-0000-0000-0000-000000000001",
        "username": "admin",
        "password": "Admin123!",
        "role": "ADMIN",
        "full_name": "Демо-доступ",
    },
    "analyst": {
        "id": "00000000-0000-0000-0000-000000000002",
        "username": "analyst",
        "password": "Analyst123!",
        "role": "TEST_ANALYST",
        "full_name": "Демо-доступ",
    },
    "manager": {
        "id": "00000000-0000-0000-0000-000000000003",
        "username": "manager",
        "password": "Manager123!",
        "role": "QUALITY_MANAGER",
        "full_name": "Демо-доступ",
    },
}


def _token_response(user: dict) -> dict[str, str]:
    token_payload = {"sub": user["id"], "role": user["role"], "username": user["username"]}
    return {
        "access_token": create_access_token(token_payload),
        "refresh_token": create_refresh_token(token_payload),
        "token_type": "bearer",
        "username": user["username"],
        "role": user["role"],
        "full_name": user.get("full_name") or user["username"],
    }


@router.post("/login")
async def login(
    payload: LoginRequest,
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    # Демо-учётки активны ТОЛЬКО в DEMO_MODE. В проде — никаких встроенных паролей
    # (требование к управлению учётными данными, ГОСТ Р 57580, 152-ФЗ).
    if settings.DEMO_MODE:
        demo_user = DEMO_USERS.get(payload.username)
        if demo_user and payload.password == demo_user["password"]:
            return _token_response(demo_user)

    result = await db.execute(select(User).where(User.username == payload.username))
    user = result.scalar_one_or_none()
    if user is None or not user.is_active or not verify_password(payload.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return _token_response(
        {
            "id": str(user.id),
            "username": user.username,
            "role": user.role,
            "full_name": user.full_name,
        }
    )


@router.post("/refresh")
async def refresh_token(payload: TokenRefreshRequest) -> dict[str, str]:
    try:
        token = decode_token(payload.refresh_token, expected_type="refresh")
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc
    return {
        "access_token": create_access_token({"sub": token.sub, "role": token.role, "username": token.username}),
        "refresh_token": create_refresh_token({"sub": token.sub, "role": token.role, "username": token.username}),
        "token_type": "bearer",
        "role": token.role,
    }
