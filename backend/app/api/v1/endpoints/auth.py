# backend/app/api/v1/endpoints/auth.py
"""
Эндпоинты аутентификации и авторизации
"""
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime, timedelta, timezone
from typing import Optional
import os
from jose import jwt, JWTError
import logging

from app.api.deps import get_db
from app.schemas.auth import (
    LoginRequest,
    TokenResponse,
    TokenRefreshRequest,
    UserResponse,
    DemoUserCredentials
)
from app.core.config import settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth", tags=["auth"])
security = HTTPBearer()

# Демо-пользователи (только для development!)
DEMO_USERS: dict[str, DemoUserCredentials] = {}
if os.getenv("DEMO_MODE", "false").lower() == "true":
    DEMO_USERS = {
        "demo_analyst": DemoUserCredentials(
            username="demo_analyst",
            password="Analyst123!",
            role="TEST_ANALYST"
        ),
        "demo_manager": DemoUserCredentials(
            username="demo_manager", 
            password="Manager123!",
            role="QUALITY_MANAGER"
        ),
        "admin": DemoUserCredentials(
            username="admin",
            password="Admin123!",
            role="ADMIN"
        )
    }

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Создание JWT access токена"""
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire, "type": "access"})
    return jwt.encode(to_encode, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)

def create_refresh_token(data: dict) -> str:
    """Создание JWT refresh токена"""
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    to_encode.update({"exp": expire, "type": "refresh"})
    return jwt.encode(to_encode, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)

def verify_password(plain: str, hashed: str) -> bool:
    """Проверка пароля (заглушка для демо)"""
    # В продакшене использовать passlib: return pwd_context.verify(plain, hashed)
    return plain == hashed

@router.post("/login", response_model=TokenResponse)
async def login(credentials: LoginRequest):
    """
    Аутентификация пользователя и получение токенов
    """
    # Поиск пользователя в демо-базе
    user = DEMO_USERS.get(credentials.username)
    
    if not user or not verify_password(credentials.password, user.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Неверное имя пользователя или пароль",
            headers={"WWW-Authenticate": "Bearer"}
        )
    
    # Создание токенов
    token_data = {
        "sub": user.username,
        "username": user.username,
        "roles": [user.role],
        "user_id": f"demo-{user.username}"
    }
    
    access_token = create_access_token(token_data)
    refresh_token = create_refresh_token(token_data)
    
    logger.info(f"User {user.username} logged in successfully")
    
    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60
    )

@router.post("/refresh", response_model=TokenResponse)
async def refresh_token(request: TokenRefreshRequest):
    """
    Обновление access токена через refresh токен
    """
    try:
        payload = jwt.decode(
            request.refresh_token,
            settings.JWT_SECRET_KEY,
            algorithms=[settings.JWT_ALGORITHM]
        )
        
        if payload.get("type") != "refresh":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Неверный тип токена"
            )
        
        # Создание нового access токена
        token_data = {
            "sub": payload.get("sub"),
            "username": payload.get("username"),
            "roles": payload.get("roles", []),
            "user_id": payload.get("user_id")
        }
        
        new_access_token = create_access_token(token_data)
        
        return TokenResponse(
            access_token=new_access_token,
            token_type="bearer",
            expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60
        )
        
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh токен истёк"
        )
    except jwt.JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Неверный refresh токен"
        )

@router.get("/me", response_model=UserResponse)
async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security)
):
    """
    Получение данных текущего пользователя
    """
    try:
        payload = jwt.decode(
            credentials.credentials,
            settings.JWT_SECRET_KEY,
            algorithms=[settings.JWT_ALGORITHM]
        )
        
        return UserResponse(
            id=payload.get("user_id", "unknown"),
            username=payload.get("username", "unknown"),
            roles=payload.get("roles", []),
            is_active=True
        )
        
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Токен истёк"
        )
    except jwt.JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Неверный токен"
        )

@router.post("/logout")
async def logout():
    """
    Выход из системы (инвалидация токена)
    В демо-режиме - заглушка
    """
    # В продакшене: добавить токен в blacklist в Redis
    return {"message": "Выход выполнен успешно"}