"""
Короткоживущее key-value хранилище для контроля сессий и анти-брутфорса (ИБ-10, ИБ-12).

Основная реализация — Redis (общий для всех воркеров uvicorn: счётчик неудачных входов и
список отозванных токенов обязаны быть едиными на процесс-пул, иначе лимит «5 попыток»
умножался бы на число воркеров, а отзыв токена действовал бы только в одном из них).

Если Redis недоступен (локальный запуск без Docker, юнит-тесты), используется память
процесса — с предупреждением в лог. Это осознанный fail-open по доступности, но не по
безопасности: механизмы продолжают работать, просто без разделения между процессами.
"""
from __future__ import annotations

import logging
import time
from typing import Protocol

from app.infrastructure.config import settings

logger = logging.getLogger(__name__)


class KeyValueStore(Protocol):
    async def get(self, key: str) -> str | None: ...
    async def mget(self, keys: list[str]) -> list[str | None]: ...
    async def set(self, key: str, value: str, ttl: int, nx: bool = False) -> bool: ...
    async def incr(self, key: str, ttl: int) -> int: ...
    async def ttl(self, key: str) -> int: ...
    async def delete(self, *keys: str) -> None: ...


class MemoryKV:
    """In-process реализация с TTL. Для тестов и работы без Redis."""

    def __init__(self) -> None:
        self._data: dict[str, tuple[str, float]] = {}

    def _alive(self, key: str) -> tuple[str, float] | None:
        item = self._data.get(key)
        if item is None:
            return None
        if item[1] <= time.monotonic():
            self._data.pop(key, None)
            return None
        return item

    async def get(self, key: str) -> str | None:
        item = self._alive(key)
        return item[0] if item else None

    async def mget(self, keys: list[str]) -> list[str | None]:
        return [await self.get(k) for k in keys]

    async def set(self, key: str, value: str, ttl: int, nx: bool = False) -> bool:
        if nx and self._alive(key) is not None:
            return False
        self._data[key] = (value, time.monotonic() + max(1, ttl))
        return True

    async def incr(self, key: str, ttl: int) -> int:
        item = self._alive(key)
        if item is None:
            self._data[key] = ("1", time.monotonic() + max(1, ttl))
            return 1
        value = int(item[0]) + 1
        self._data[key] = (str(value), item[1])   # TTL окна не продлевается каждой попыткой
        return value

    async def ttl(self, key: str) -> int:
        item = self._alive(key)
        return max(0, int(item[1] - time.monotonic())) if item else 0

    async def delete(self, *keys: str) -> None:
        for k in keys:
            self._data.pop(k, None)


class RedisKV:
    def __init__(self, client) -> None:  # redis.asyncio.Redis
        self._r = client

    async def get(self, key: str) -> str | None:
        return await self._r.get(key)

    async def mget(self, keys: list[str]) -> list[str | None]:
        return list(await self._r.mget(keys)) if keys else []

    async def set(self, key: str, value: str, ttl: int, nx: bool = False) -> bool:
        return bool(await self._r.set(key, value, ex=max(1, ttl), nx=nx))

    async def incr(self, key: str, ttl: int) -> int:
        pipe = self._r.pipeline()
        pipe.incr(key)
        pipe.expire(key, max(1, ttl), nx=True)   # TTL — только на первой попытке окна
        value, _ = await pipe.execute()
        return int(value)

    async def ttl(self, key: str) -> int:
        return max(0, int(await self._r.ttl(key)))

    async def delete(self, *keys: str) -> None:
        if keys:
            await self._r.delete(*keys)


_store: KeyValueStore | None = None


async def get_kv() -> KeyValueStore:
    """Хранилище процесса: Redis, если отвечает на PING, иначе память (с предупреждением)."""
    global _store
    if _store is not None:
        return _store
    try:
        import redis.asyncio as aioredis

        client = aioredis.from_url(settings.REDIS_URL, decode_responses=True, socket_connect_timeout=1)
        await client.ping()
        _store = RedisKV(client)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Redis недоступен (%s): контроль сессий и входов работает в памяти процесса", type(exc).__name__)
        _store = MemoryKV()
    return _store


def use_store(store: KeyValueStore | None) -> None:
    """Подменить хранилище (тесты) или сбросить выбор (None → заново определить при обращении)."""
    global _store
    _store = store
