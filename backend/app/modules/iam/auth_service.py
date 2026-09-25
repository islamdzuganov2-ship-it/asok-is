"""
Сценарии аутентификации (ИБ-08, ИБ-10, ИБ-12): вход, продление сессии, выход.

Роутер (`iam/router.py`) только переводит исключения этого модуля в HTTP-ответы.

Вход:
  1) если пара «логин+IP» или логин заблокированы — отказ ДО проверки пароля (throttle);
  2) неверный пароль — счётчик неудач, событие в журнал; при достижении порога — блокировка
     и отдельное событие `auth.login_locked`;
  3) успех — сброс счётчика пары, `last_login`, событие `auth.login`, новая сессия (sid).

Продление (`/auth/refresh`) — ротация: старый refresh одноразовый; пользователь сверяется с БД
(существует, активен, роль не менялась). Повторное предъявление refresh = кража → отзыв сессии.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

from jose import JWTError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.config import settings
from app.infrastructure.request_context import client_ip_var
from app.modules.iam import audit, sessions, throttle
from app.modules.iam.models import User
from app.modules.iam.schemas import TokenPayload
from app.modules.iam.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    verify_password,
)


class InvalidCredentials(Exception):
    pass


@dataclass
class LoginLocked(Exception):
    retry_after: int


class RefreshDenied(Exception):
    pass


# Встроенные демо-учётки: активны ТОЛЬКО в DEMO_MODE (ГОСТ Р 57580, 152-ФЗ — в проде
# встроенных паролей нет). Их нет в БД, поэтому сверка активности при refresh для них
# пропускается — но лишь пока DEMO_MODE включён.
DEMO_USERS = {
    "superadmin": {"id": "00000000-0000-0000-0000-000000000000", "username": "superadmin",
                   "password": "Super123!", "role": "SUPER_ADMIN", "full_name": "Супер-администратор"},
    "admin": {"id": "00000000-0000-0000-0000-000000000001", "username": "admin",
              "password": "Admin123!", "role": "ADMIN", "full_name": "Демо-доступ"},
    "analyst": {"id": "00000000-0000-0000-0000-000000000002", "username": "analyst",
                "password": "Analyst123!", "role": "TEST_ANALYST", "full_name": "Демо-доступ"},
    "manager": {"id": "00000000-0000-0000-0000-000000000003", "username": "manager",
                "password": "Manager123!", "role": "QUALITY_MANAGER", "full_name": "Демо-доступ"},
}
_DEMO_IDS = {u["id"] for u in DEMO_USERS.values()}


def _token_response(user: dict, sid: str | None = None) -> dict[str, str]:
    session = sid or uuid.uuid4().hex
    claims = {"sub": user["id"], "role": user["role"], "username": user["username"], "sid": session}
    return {
        "access_token": create_access_token(claims),
        "refresh_token": create_refresh_token(claims),
        "token_type": "bearer",
        "username": user["username"],
        "role": user["role"],
        "full_name": user.get("full_name") or user["username"],
    }


async def login(db: AsyncSession, username: str, password: str) -> dict[str, str]:
    ip = client_ip_var.get()
    state = await throttle.check(username, ip)
    if state.locked:
        await audit.record_now(db, audit.AUTH_LOGIN_LOCKED, username=username, outcome=audit.OUTCOME_DENIED,
                               entity_type="user", entity_key=username, new={"retry_after": state.retry_after})
        raise LoginLocked(state.retry_after)

    if settings.DEMO_MODE:
        demo = DEMO_USERS.get(username)
        if demo and password == demo["password"]:
            await throttle.register_success(username, ip)
            await audit.record_now(db, audit.AUTH_LOGIN, user=demo, entity_type="user", entity_id=demo["id"],
                                   new={"role": demo["role"], "source": "demo"})
            return _token_response(demo)

    user = (await db.execute(select(User).where(User.username == username))).scalar_one_or_none()
    if user is None or not user.is_active or not verify_password(password, user.password_hash):
        after = await throttle.register_failure(username, ip)
        reason = "unknown_user" if user is None else ("inactive" if not user.is_active else "bad_password")
        await audit.record_now(db, audit.AUTH_LOGIN_FAILED, username=username, outcome=audit.OUTCOME_FAILURE,
                               user={"id": str(user.id)} if user else None,
                               entity_type="user", entity_key=username, new={"reason": reason})
        if after.locked:
            await audit.record_now(db, audit.AUTH_LOGIN_LOCKED, username=username, outcome=audit.OUTCOME_DENIED,
                                   entity_type="user", entity_key=username,
                                   new={"retry_after": after.retry_after})
        raise InvalidCredentials()

    await throttle.register_success(username, ip)
    user.last_login = datetime.now(timezone.utc)
    info = {"id": str(user.id), "username": user.username, "role": user.role, "full_name": user.full_name}
    await audit.record(db, audit.AUTH_LOGIN, user=info, entity_type="user", entity_id=user.id,
                       new={"role": user.role})
    await db.commit()
    return _token_response(info)


async def refresh(db: AsyncSession, refresh_token: str) -> dict[str, str]:
    try:
        token = decode_token(refresh_token, expected_type="refresh")
    except (JWTError, KeyError, ValueError) as exc:
        raise RefreshDenied() from exc

    denied = {"id": token.sub, "username": token.username}
    if await sessions.is_revoked(token):
        await audit.record_now(db, audit.AUTH_REFRESH_DENIED, user=denied, outcome=audit.OUTCOME_DENIED,
                               entity_type="session", entity_key=token.sid, new={"reason": "revoked"})
        raise RefreshDenied()
    if not await sessions.consume_refresh(token):
        # Повторное использование одноразового refresh — токен украден: закрываем всю сессию.
        await sessions.revoke_session(token.sid)
        await audit.record_now(db, audit.AUTH_REFRESH_REUSE, user=denied, outcome=audit.OUTCOME_DENIED,
                               entity_type="session", entity_key=token.sid)
        raise RefreshDenied()

    role = token.role
    is_demo = settings.DEMO_MODE and token.sub in _DEMO_IDS
    if not is_demo:
        try:
            user = await db.get(User, uuid.UUID(token.sub))
        except ValueError:
            user = None
        reason = None
        if user is None or getattr(user, "is_deleted", False):
            reason = "user_missing"
        elif not user.is_active:
            reason = "inactive"
        elif user.role != token.role:
            # Смена роли — принудительный перелогин: права сессии выданы под старую роль.
            reason = "role_changed"
        if reason:
            await sessions.revoke_session(token.sid)
            await audit.record_now(db, audit.AUTH_REFRESH_DENIED, user=denied, outcome=audit.OUTCOME_DENIED,
                                   entity_type="session", entity_key=token.sid, new={"reason": reason})
            raise RefreshDenied()
        role = user.role

    user_info = {"id": token.sub, "username": token.username or token.sub, "role": role}
    await audit.record_now(db, audit.AUTH_REFRESH, user=user_info, entity_type="session", entity_key=token.sid)
    body = _token_response(user_info, sid=token.sid)
    return {k: body[k] for k in ("access_token", "refresh_token", "token_type", "role")}


async def logout(db: AsyncSession, access: TokenPayload, refresh_token: str | None) -> None:
    """Серверный выход: отзыв текущего access и всей сессии (вместе с её refresh)."""
    await sessions.revoke_token(access)
    await sessions.revoke_session(access.sid)
    if refresh_token:
        try:
            rt = decode_token(refresh_token, expected_type="refresh")
            if rt.sub == access.sub:
                await sessions.revoke_token(rt)
                await sessions.revoke_session(rt.sid)
        except (JWTError, KeyError, ValueError):
            pass   # мусорный refresh при выходе не ошибка: access уже отозван
    await audit.record_now(db, audit.AUTH_LOGOUT, user={"id": access.sub, "username": access.username},
                           entity_type="session", entity_key=access.sid)
