"""
Фабрика Redis-клиента — каноническое место (ТЗ v13).

Единая точка создания синхронного redis-клиента из настроек (REDIS_URL): кэш, celery-утилиты.
Асинхронный клиент добавим при появлении реального async-потребителя.
"""
from __future__ import annotations

import redis

from app.infrastructure.config import settings


def get_redis(decode_responses: bool = True) -> "redis.Redis":
    """Синхронный Redis-клиент из настроек (REDIS_URL)."""
    return redis.from_url(settings.REDIS_URL, decode_responses=decode_responses)
