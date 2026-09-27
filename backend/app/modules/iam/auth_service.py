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

Смена пароля (ИБ-11, `/auth/change-password`): временный пароль от администратора даёт токен с
признаком `pwd_change` — с ним открыты только смена пароля и выход (deps.get_current_user).
Смена проверяет текущий пароль (неудачи идут в анти-брутфорс), парольную политику и историю,
закрывает все прежние сессии и выдаёт новую пару токенов без признака.
"""
from __future__ import annotations

import logging
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
from app.modules.iam.password_policy import (
    ensure_acceptable,
    previous_hashes,
    push_history,
)
from app.modules.iam.schemas import TokenPayload
from app.modules.iam.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    get_password_hash,
    verify_password,
)

logger = logging.getLogger(__name__)


class InvalidCredentials(Exception):
    pass


@dataclass
class LoginLocked(Exception):
    retry_after: int


class RefreshDenied(Exception):
    pass


class WrongCurrentPassword(Exception):
    pass


class PasswordNotChangeable(Exception):
    """Учётка вне БД (встроенная демо-учётка): пароль задаётся в коде демо-стенда."""


def demo_users() -> dict[str, dict]:
    """Встроенные демо-учётки (ИБ-02): только при DEMO_MODE и только если модуль есть в сборке —
    из продуктивного образа он исключён (.dockerignore). Нет модуля — демо-вход недоступен,
    приложение работает дальше (предупреждение в лог), а не падает."""
    if not settings.DEMO_MODE:
        return {}
    try:
        from app.modules.iam.demo_users import DEMO_USERS
    except ImportError:
        logger.warning("DEMO_MODE включён, но демо-учётки не входят в эту сборку — демо-вход недоступен")
        return {}
    return DEMO_USERS


def _token_response(user: dict, sid: str | None = None, must_change_password: bool = False) -> dict:
    session = sid or uuid.uuid4().hex
    claims = {"sub": user["id"], "role": user["role"], "username": user["username"], "sid": session}
    if must_change_password:
        claims["pwd_change"] = True
    return {
        "access_token": create_access_token(claims),
        "refresh_token": create_refresh_token(claims),
        "token_type": "bearer",
        "username": user["username"],
        "role": user["role"],
        "full_name": user.get("full_name") or user["username"],
        "must_change_password": must_change_password,
    }


async def login(db: AsyncSession, username: str, password: str) -> dict:
    ip = client_ip_var.get()
    state = await throttle.check(username, ip)
    if state.locked:
        await audit.record_now(db, audit.AUTH_LOGIN_LOCKED, username=username, outcome=audit.OUTCOME_DENIED,
                               entity_type="user", entity_key=username, new={"retry_after": state.retry_after})
        raise LoginLocked(state.retry_after)

    if settings.DEMO_MODE:
        demo = demo_users().get(username)
        # Сверка bcrypt-хэша (за постоянное время), а не сравнение открытого текста через ==.
        if demo and verify_password(password, demo["password_hash"]):
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
    return _token_response(info, must_change_password=bool(user.must_change_password))


async def refresh(db: AsyncSession, refresh_token: str) -> dict:
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
    must_change = False
    is_demo = token.sub in {u["id"] for u in demo_users().values()}
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
        # ИБ-11: признак обязательной смены пароля — из БД, а не из старого токена: продление
        # не снимает его до смены и не навешивает после.
        must_change = bool(user.must_change_password)

    user_info = {"id": token.sub, "username": token.username or token.sub, "role": role}
    await audit.record_now(db, audit.AUTH_REFRESH, user=user_info, entity_type="session", entity_key=token.sid)
    body = _token_response(user_info, sid=token.sid, must_change_password=must_change)
    return {k: body[k] for k in ("access_token", "refresh_token", "token_type", "role", "must_change_password")}


async def change_password(db: AsyncSession, current: dict, current_password: str, new_password: str) -> dict:
    """Смена собственного пароля (ИБ-11). Исключения: LoginLocked, WrongCurrentPassword,
    PasswordNotChangeable, PasswordPolicyError."""
    try:
        user = await db.get(User, uuid.UUID(str(current["id"])))
    except ValueError:
        user = None
    if user is None or user.is_deleted:
        raise PasswordNotChangeable()

    # Подбор текущего пароля через смену — тот же анти-брутфорс, что и у входа (ИБ-10).
    ip = client_ip_var.get()
    state = await throttle.check(user.username, ip)
    if state.locked:
        raise LoginLocked(state.retry_after)
    if not verify_password(current_password, user.password_hash):
        await throttle.register_failure(user.username, ip)
        await audit.record_now(db, audit.USER_PASSWORD_CHANGE, user=current, outcome=audit.OUTCOME_FAILURE,
                               entity_type="user", entity_id=user.id, new={"reason": "bad_current_password"})
        raise WrongCurrentPassword()
    await throttle.register_success(user.username, ip)

    previous = previous_hashes(user.password_hash, user.password_history)
    ensure_acceptable(new_password, user.username, previous)   # PasswordPolicyError → 422
    user.password_hash = get_password_hash(new_password)
    user.password_history = push_history(previous, user.password_hash)
    user.password_changed_at = datetime.now(timezone.utc)
    user.must_change_password = False
    info = {"id": str(user.id), "username": user.username, "role": user.role, "full_name": user.full_name}
    await audit.record(db, audit.USER_PASSWORD_CHANGE, user=info, entity_type="user", entity_id=user.id)
    await db.commit()
    # Все прежние сессии (включая текущую — с признаком смены) закрываются: новая пара токенов.
    await sessions.revoke_user(str(user.id))
    return _token_response(info)


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
