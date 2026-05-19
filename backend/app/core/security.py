"""
Утилиты безопасности: хеширование паролей и JWT-токены.
"""
from datetime import datetime, timedelta
from typing import Any, Union

from jose import jwt
from passlib.context import CryptContext

from app.core.config import settings

# Контекст хеширования
pwd_context = CryptContext(
    schemes=["sha256_crypt"],
    deprecated="auto"
)

ALGORITHM = settings.JWT_ALGORITHM
SECRET_KEY = settings.JWT_SECRET_KEY

def create_access_token(
    data: dict,
    expires_delta: Union[timedelta, None] = None
) -> str:
    """Создать JWT access-токен."""
    to_encode = data.copy()
    expire = datetime.utcnow() + (
        expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

def create_refresh_token(
    data: dict,
    expires_delta: Union[timedelta, None] = None
) -> str:
    """Создать JWT refresh-токен."""
    to_encode = data.copy()
    expire = datetime.utcnow() + (
        expires_delta or timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    )
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt