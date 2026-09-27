"""
Криптография домена iam (ТЗ v13): хэширование паролей и JWT (access/refresh).
Каноническое место; app.core.security — shim отсюда.

ИБ-12 (SEC-05): у каждого токена есть `jti` (идентификатор для отзыва), `sid` (сессия —
общая для access и всей цепочки ротируемых refresh одного входа) и `iat` (время выдачи —
для отзыва «всех токенов пользователя, выданных до момента X»). Проверка отзыва —
в iam/sessions.py, вызывается из get_current_user и /auth/refresh.
"""
import logging
import uuid
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


def _claims(data: Dict, token_type: str, lifetime: timedelta) -> Dict:
    now = datetime.now(timezone.utc)
    to_encode = data.copy()
    to_encode.update({
        "exp": now + lifetime,
        # NumericDate с миллисекундами: отзыв пользователя сравнивает iat с моментом отзыва,
        # и вход сразу после отзыва (в ту же секунду) не должен считаться «выданным до».
        "iat": round(now.timestamp(), 3),
        "type": token_type,
        "jti": uuid.uuid4().hex,
        # sid приходит из вызывающего кода (пара access+refresh одного входа и все ротации
        # refresh делят одну сессию); если не передан — новая сессия.
        "sid": to_encode.get("sid") or uuid.uuid4().hex,
    })
    return to_encode


def create_access_token(data: Dict, expires_delta: Optional[timedelta] = None) -> str:
    lifetime = expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    return jwt.encode(_claims(data, "access", lifetime), _jwt_secret(), algorithm=settings.JWT_ALGORITHM)


def create_refresh_token(data: Dict) -> str:
    lifetime = timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    return jwt.encode(_claims(data, "refresh", lifetime), _jwt_secret(), algorithm=settings.JWT_ALGORITHM)


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
        username=payload.get("username"),
        jti=payload.get("jti"),
        sid=payload.get("sid"),
        iat=payload.get("iat"),
        type=payload.get("type"),
        pwd_change=payload.get("pwd_change"),
    )
