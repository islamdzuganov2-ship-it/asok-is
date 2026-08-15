---
tags:
  - бэк
---

# АСОК ИС — Backend Core (config, database, security, rbac)
**Дата:** 2026-05-17 | **Итерация:** 1

## backend/app/core/config.py
```python
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", case_sensitive=True)
    DATABASE_URL: str = Field(...)
    REDIS_URL: str = Field(default="redis://localhost:6379/0")
    JWT_SECRET: str = Field(...)
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    OLLAMA_API_URL: str = "http://ollama:11434/api/generate"
    OLLAMA_MODEL: str = "llama3:8b"
    FEATURE_LDAP_AUTH: bool = False
    FEATURE_JIRA_INTEGRATION: bool = False
    FEATURE_MONITORING_INTEGRATION: bool = False
    FEATURE_AI_SUMMARY: bool = True
    FEATURE_LOG_EXPORT: bool = False
    FEATURE_PDF_REPORTS: bool = False
    DEMO_MODE: bool = True
    LOG_LEVEL: str = "INFO"
    CORS_ORIGINS: list[str] = ["http://localhost:3000"]
    RATE_LIMIT_PER_MINUTE: int = 100

settings = Settings()
```

## backend/app/core/database.py
```python
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from app.core.config import settings

_async_url = settings.DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://")
engine = create_async_engine(_async_url, echo=False, pool_size=20, max_overflow=10, pool_pre_ping=True)
AsyncSessionLocal = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False, autoflush=False, autocommit=False)

class Base(DeclarativeBase):
    pass

async def get_db() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
```

## backend/app/core/security.py
```python
from datetime import datetime, timedelta, timezone
from typing import Any
import uuid
from jose import JWTError, jwt
from passlib.context import CryptContext
from app.core.config import settings
from app.schemas.auth import TokenPayload

_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def hash_password(plain_password: str) -> str:
    return _pwd_context.hash(plain_password)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return _pwd_context.verify(plain_password, hashed_password)

def create_access_token(user_id: uuid.UUID, role: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    payload: dict[str, Any] = {"sub": str(user_id), "role": role, "exp": expire, "type": "access"}
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)

def create_refresh_token(user_id: uuid.UUID) -> str:
    expire = datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    payload: dict[str, Any] = {"sub": str(user_id), "exp": expire, "type": "refresh"}
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)

def decode_token(token: str) -> TokenPayload:
    payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    return TokenPayload(**payload)
```

## backend/app/core/rbac.py
```python
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError
from app.core.security import decode_token
from app.models.user import User
from app.schemas.auth import TokenPayload

_bearer_scheme = HTTPBearer()

async def get_current_token(credentials: HTTPAuthorizationCredentials = Depends(_bearer_scheme)) -> TokenPayload:
    try:
        return decode_token(credentials.credentials)
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Недействительный или истёкший токен.", headers={"WWW-Authenticate": "Bearer"})

def require_roles(*allowed_roles: str):
    async def _check_role(token: TokenPayload = Depends(get_current_token)) -> TokenPayload:
        if token.role not in allowed_roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"Требуется одна из ролей: {', '.join(allowed_roles)}. Ваша роль: {token.role}.")
        return token
    return _check_role

require_admin = require_roles("ADMIN")
require_manager_or_admin = require_roles("QUALITY_MANAGER", "ADMIN")
require_analyst_or_above = require_roles("TEST_ANALYST", "QUALITY_MANAGER", "ADMIN")
require_any_authenticated = require_roles(*User.ALL_ROLES)
```
