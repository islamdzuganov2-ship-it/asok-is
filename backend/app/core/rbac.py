from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError

from app.core.security import decode_token
from app.schemas.auth import TokenPayload

_bearer_scheme = HTTPBearer()


async def get_current_token(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer_scheme),
) -> TokenPayload:
    try:
        return decode_token(credentials.credentials)
    except (JWTError, Exception):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Недействительный или истёкший токен.",
            headers={"WWW-Authenticate": "Bearer"},
        )


def require_roles(*allowed_roles: str):
    async def _check_role(token: TokenPayload = Depends(get_current_token)) -> TokenPayload:
        if token.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Требуется: {', '.join(allowed_roles)}. Ваша роль: {token.role}.",
            )
        return token
    return _check_role


require_admin             = require_roles("ADMIN")
require_manager_or_admin  = require_roles("QUALITY_MANAGER", "ADMIN")
require_analyst_or_above  = require_roles("TEST_ANALYST", "QUALITY_MANAGER", "ADMIN")
require_any_authenticated = require_roles(
    "TEST_ANALYST", "QUALITY_MANAGER", "CTO", "CEO", "ADMIN"
)