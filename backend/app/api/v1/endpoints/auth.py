"""
Аутентификация: вход в систему.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import create_access_token, pwd_context
from app.core.config import settings

router = APIRouter()

# Демо-пользователи (временно)
DEMO_USERS = {
    "admin": {
        "username": "admin",
        "hashed_password": pwd_context.hash("Admin123!"),
        "role": "admin",
        "full_name": "Администратор"
    },
    "analyst": {
        "username": "analyst",
        "hashed_password": pwd_context.hash("Analyst123!"),
        "role": "analyst",
        "full_name": "Аналитик"
    },
    "manager": {
        "username": "manager",
        "hashed_password": pwd_context.hash("Manager123!"),
        "role": "manager",
        "full_name": "Руководитель"
    }
}

def verify_password(plain: str, hashed: str) -> bool:
    """Безопасная проверка пароля."""
    return pwd_context.verify(plain, hashed)

def get_user(username: str):
    """Заглушка получения пользователя."""
    return DEMO_USERS.get(username)

@router.post("/login")
async def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: AsyncSession = Depends(get_db) if not settings.DEMO_MODE else None
):
    """
    Аутентификация по логину/паролю.
    В демо-режиме не требует базы данных.
    """
    try:
        user = get_user(form_data.username)
        if not user or not verify_password(form_data.password, user["hashed_password"]):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Неверные учетные данные",
                headers={"WWW-Authenticate": "Bearer"},
            )

        access_token = create_access_token(
            data={"sub": user["username"], "role": user["role"]}
        )

        return {
            "access_token": access_token,
            "token_type": "bearer",
            "username": user["username"],
            "role": user["role"],
            "full_name": user["full_name"]
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Ошибка сервера при аутентификации: {str(e)}"
        )