"""
Аутентификация: вход в систему.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional

from app.core.database import get_db
from app.core.security import create_access_token, pwd_context
from app.core.config import settings

router = APIRouter()

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
    return pwd_context.verify(plain, hashed)

def get_user(username: str):
    return DEMO_USERS.get(username)

@router.post("/login")
async def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: AsyncSession = Depends(get_db)  # всегда внедряем, но не используем в DEMO
):
    """
    Аутентификация. В DEMO_MODE БД не используется.
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
            detail=f"Ошибка сервера: {str(e)}"
        )