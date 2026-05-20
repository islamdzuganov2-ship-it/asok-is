from passlib.context import CryptContext
from jose import jwt, JWTError
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict
import logging

from app.core.config import settings
from app.schemas.auth import TokenPayload

logger = logging.getLogger(__name__)
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto", bcrypt__rounds=12)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)


def create_access_token(data: Dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    to_encode.update({"exp": expire, "type": "access"})
    # Используем то имя которое реально есть в config.py
    secret = getattr(settings, "JWT_SECRET_KEY", None) or getattr(settings, "JWT_SECRET")
    return jwt.encode(to_encode, secret, algorithm=settings.JWT_ALGORITHM)


def create_refresh_token(data: Dict) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    to_encode.update({"exp": expire, "type": "refresh"})
    secret = getattr(settings, "JWT_SECRET_KEY", None) or getattr(settings, "JWT_SECRET")
    return jwt.encode(to_encode, secret, algorithm=settings.JWT_ALGORITHM)


def decode_token(token: str) -> TokenPayload:
    """Декодирует JWT. Raises JWTError при невалидном токене."""
    secret = getattr(settings, "JWT_SECRET_KEY", None) or getattr(settings, "JWT_SECRET")
    payload = jwt.decode(token, secret, algorithms=[settings.JWT_ALGORITHM])
    return TokenPayload(
        sub=str(payload["sub"]),
        role=payload.get("role", ""),
        exp=int(payload["exp"]),
    )