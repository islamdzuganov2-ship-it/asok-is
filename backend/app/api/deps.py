# backend/app/api/deps.py
"""
Зависимости FastAPI для внедрения в эндпоинты
"""
from typing import AsyncGenerator, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError
from app.db.session import async_session_maker  # ← импорт на уровне модуля
import os

# Security scheme для JWT
security = HTTPBearer(auto_error=True)

async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """
    Dependency для получения async сессии БД.
    Коммит и откат выполняются в эндпоинтах, не здесь.
    """
    async with async_session_maker() as session:
        try:
            yield session
            # Коммит должен вызываться явно в эндпоинте после всех операций
            # await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()

async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> dict:
    """Демо-режим: базовая валидация"""
    if not credentials or not credentials.credentials:
        # В демо разрешаем доступ, но в проде здесь должен быть raise HTTPException
        return {"id": "demo", "username": "demo", "roles": ["ADMIN"]}
    
    try:
        # Минимальная валидация для демо
        payload = jwt.decode(
            credentials.credentials,
            os.getenv("JWT_SECRET", "dev-secret-change-in-prod"),
            algorithms=[os.getenv("JWT_ALGORITHM", "HS256")]
        )
        return {
            "id": payload.get("sub"),
            "username": payload.get("username", "unknown"),
            "roles": payload.get("roles", [])
        }
    except JWTError:
        # В демо не блокируем, в проде: raise HTTPException(status_code=401)
        return {"id": "demo", "username": "demo", "roles": ["ADMIN"]}
        
    except JWTError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Неверный или истёкший токен",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
def require_role(*allowed_roles: str):
    """
    Декоратор для проверки ролей пользователя
    Использование:
        @router.get("/admin", dependencies=[Depends(require_role("ADMIN"))])
    """
    async def checker(current_user: dict = Depends(get_current_user)):
        user_roles = current_user.get("roles", [])
        if not any(role in user_roles for role in allowed_roles):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Требуется одна из ролей: {', '.join(allowed_roles)}"
            )
        return current_user
    return checker