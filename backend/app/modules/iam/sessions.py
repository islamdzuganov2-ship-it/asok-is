"""
Управление сессиями (ИБ-12; SEC-05 в docs/SECURITY_AUDIT_RF_2026-09-08.md).

До ИБ-12 токен нельзя было отозвать: ни выход, ни блокировка учётной записи, ни смена роли
не прекращали доступ до истечения TTL (refresh — 7 суток), а `/auth/refresh` продлевал
сессию заблокированному пользователю бесконечно.

Модель:
  • `jti` — отзыв конкретного токена (выход из системы);
  • `sid` — отзыв всей сессии: access + вся цепочка ротируемых refresh одного входа
    (выход, обнаружение повторного использования refresh);
  • отзыв пользователя — «все токены, выданные до момента T» (блокировка, смена роли,
    сброс пароля, удаление): ключ хранит T, токен с `iat < T` отвергается.

Ротация refresh с обнаружением повторного использования: каждый refresh одноразовый.
Предъявили уже использованный — значит, его украли и используют параллельно с владельцем;
отзываем ВСЮ сессию, чтобы у атакующего и у жертвы не осталось валидных токенов.

TTL ключей — не дольше жизни самих токенов: после истечения токена запись об отзыве не нужна.
"""
from __future__ import annotations

import time

from app.infrastructure.config import settings
from app.infrastructure.kv import get_kv
from app.modules.iam.schemas import TokenPayload

_PREFIX = "asok:auth"


def _refresh_ttl() -> int:
    return settings.REFRESH_TOKEN_EXPIRE_DAYS * 86400


def _left(payload: TokenPayload) -> int:
    """Сколько секунд токену осталось жить (не меньше 1)."""
    return max(1, int(payload.exp - time.time()))


async def revoke_token(payload: TokenPayload) -> None:
    if payload.jti:
        await (await get_kv()).set(f"{_PREFIX}:jti:{payload.jti}", "1", _left(payload))


async def revoke_session(sid: str | None) -> None:
    if sid:
        await (await get_kv()).set(f"{_PREFIX}:sid:{sid}", "1", _refresh_ttl())


async def revoke_user(user_id: str) -> None:
    """Все токены пользователя, выданные до текущего момента, становятся недействительны."""
    await (await get_kv()).set(f"{_PREFIX}:user:{user_id}", f"{time.time():.3f}", _refresh_ttl())


async def is_revoked(payload: TokenPayload) -> bool:
    kv = await get_kv()
    keys = [
        f"{_PREFIX}:jti:{payload.jti or '-'}",
        f"{_PREFIX}:sid:{payload.sid or '-'}",
        f"{_PREFIX}:user:{payload.sub}",
    ]
    jti_hit, sid_hit, user_cutoff = await kv.mget(keys)
    if jti_hit or sid_hit:
        return True
    if user_cutoff is not None:
        # Токены до ИБ-12 не несут iat — для них отзыв пользователя действует безусловно:
        # иначе заблокированный пользователь со «старым» токеном продолжал бы работать.
        issued = payload.iat if payload.iat is not None else 0.0
        return issued < float(user_cutoff)
    return False


async def consume_refresh(payload: TokenPayload) -> bool:
    """Отметить refresh использованным. False — токен уже был использован (повтор)."""
    if not payload.jti:
        # Refresh до ИБ-12 без jti: одноразовость проверить нечем — принимаем один раз
        # по отзыву пользователя/сессии (is_revoked), ротация выдаст уже токен с jti.
        return True
    return await (await get_kv()).set(f"{_PREFIX}:used:{payload.jti}", "1", _left(payload), nx=True)
