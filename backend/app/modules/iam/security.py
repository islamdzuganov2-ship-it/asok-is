"""
Криптография домена iam (ТЗ v13): хэширование паролей и JWT (access/refresh).
Каноническое место; app.core.security — shim отсюда.
"""
import logging
from datetime import datetime, timedelta, timezone
from typing import Dict, Optional

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.infrastructure.config import settings
from app.modules.iam.schemas import TokenPayload

logger = logging.getLogger(__name__)
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto", bcrypt__rounds=12)


def _jwt_secret() -> str:
    """Единая точка получения секрета подписи JWT."""
    return getattr(settings, "JWT_SECRET_KEY", None) or getattr(settings, "JWT_SECRET")


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
    return jwt.encode(to_encode, _jwt_secret(), algorithm=settings.JWT_ALGORITHM)


def create_refresh_token(data: Dict) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    to_encode.update({"exp": expire, "type": "refresh"})
    return jwt.encode(to_encode, _jwt_secret(), algorithm=settings.JWT_ALGORITHM)


def decode_token(token: str, expected_type: Optional[str] = None) -> TokenPayload:
    """
    Декодирует и валидирует JWT. Raises JWTError при невалидном/просроченном токене.

    expected_type: если задан ('access'|'refresh') — проверяет поле type, чтобы
    refresh-токен нельзя было использовать как access и наоборот (token-type confusion).
    """
    payload = jwt.decode(token, _jwt_secret(), algorithms=[settings.JWT_ALGORITHM])
    if expected_type is not None and payload.get("type") != expected_type:
        raise JWTError(f"Неверный тип токена: ожидался {expected_type}")
    return TokenPayload(
        sub=str(payload["sub"]),
        role=payload.get("role", ""),
        exp=int(payload["exp"]),
    )
