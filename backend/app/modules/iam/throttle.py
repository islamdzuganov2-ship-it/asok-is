"""
Анти-брутфорс входа (ИБ-10; SEC-04 в docs/SECURITY_AUDIT_RF_2026-09-08.md).

Два счётчика неудачных попыток в скользящем окне `LOGIN_FAILURE_WINDOW_S`:
  • пара «логин + IP» — `LOGIN_MAX_FAILURES` (5): подбор с одного адреса;
  • логин с любых адресов — `LOGIN_MAX_FAILURES_PER_USER` (10): распределённый подбор
    по ботнету, который пара «логин + IP» не видит.
По превышению вход блокируется на `LOGIN_LOCKOUT_S`, каждая следующая блокировка того же логина
за сутки — вдвое дольше (экспоненциальная задержка, потолок — сутки); ответ — 429 с `Retry-After`. Во время
блокировки даже ВЕРНЫЙ пароль не принимается: иначе блокировка превращалась бы в оракул
«пароль угадан» для атакующего.

Успешный вход сбрасывает счётчик пары, но не пользовательский: успех с одного адреса не
должен обнулять подбор, идущий с других.

Логин нормализуется (регистр, пробелы) — иначе «Admin» и «admin» считались бы разными целями.
"""
from __future__ import annotations

from dataclasses import dataclass

from app.infrastructure.config import settings
from app.infrastructure.kv import get_kv

_PREFIX = "asok:login"


@dataclass(frozen=True)
class LockState:
    locked: bool
    retry_after: int = 0


def _norm(username: str) -> str:
    return (username or "").strip().lower()


def _keys(username: str, ip: str | None) -> tuple[str, str, str, str]:
    u = _norm(username)
    ip = ip or "unknown"
    return (
        f"{_PREFIX}:fail:{u}:{ip}", f"{_PREFIX}:fail:{u}",
        f"{_PREFIX}:lock:{u}:{ip}", f"{_PREFIX}:lock:{u}",
    )


async def check(username: str, ip: str | None) -> LockState:
    """Заблокирован ли вход для пары/логина прямо сейчас."""
    kv = await get_kv()
    _, _, lock_pair, lock_user = _keys(username, ip)
    left = max(await kv.ttl(lock_pair), await kv.ttl(lock_user))
    return LockState(locked=left > 0, retry_after=left)


async def register_failure(username: str, ip: str | None) -> LockState:
    """Учесть неудачную попытку; вернуть состояние блокировки ПОСЛЕ неё."""
    kv = await get_kv()
    fail_pair, fail_user, lock_pair, lock_user = _keys(username, ip)
    window = settings.LOGIN_FAILURE_WINDOW_S
    pair_count = await kv.incr(fail_pair, window)
    user_count = await kv.incr(fail_user, window)
    hit_pair = pair_count >= settings.LOGIN_MAX_FAILURES
    hit_user = user_count >= settings.LOGIN_MAX_FAILURES_PER_USER
    if hit_pair or hit_user:
        lockout = await _next_lockout(kv, username)
        if hit_pair:
            await kv.set(lock_pair, "1", lockout)
            await kv.delete(fail_pair)   # новое окно после блокировки, а не мгновенный повтор
        if hit_user:
            await kv.set(lock_user, "1", lockout)
            await kv.delete(fail_user)
    return await check(username, ip)


async def _next_lockout(kv, username: str) -> int:
    """Длительность очередной блокировки: базовая × 2^(n−1) за n-ю блокировку за сутки."""
    n = await kv.incr(f"{_PREFIX}:lockouts:{_norm(username)}", 86400)
    return min(86400, settings.LOGIN_LOCKOUT_S * (2 ** (n - 1)))


async def register_success(username: str, ip: str | None) -> None:
    fail_pair, _, _, _ = _keys(username, ip)
    await (await get_kv()).delete(fail_pair)
