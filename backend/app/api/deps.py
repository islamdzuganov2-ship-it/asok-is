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
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> dict:
    """
    Валидация JWT токена и извлечение данных пользователя.
    Raises HTTPException 401 при неверном/истёкшем токене.
    """
    token = credentials.credentials
    
    # Получение секретного ключа из env
    jwt_secret = os.getenv("JWT_SECRET", "dev-secret-change-in-prod")
    jwt_algorithm = os.getenv("JWT_ALGORITHM", "HS256")
    
    try:
        payload = jwt.decode(
            token,
            jwt_secret,
            algorithms=[jwt_algorithm],
            options={"verify_exp": True}  # ← обязательно проверять срок действия
        )
        
        user_id = payload.get("sub")
        username = payload.get("username")
        roles = payload.get("roles", [])
        
        if not user_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Неверный формат токена",
                headers={"WWW-Authenticate": "Bearer"},
            )
        
        return {"id": user_id, "username": username, "roles": roles}
        
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