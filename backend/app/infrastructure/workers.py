"""
Celery-приложение — каноническое место (ТЗ v13). Брокер и бекенд результатов: Redis.

Задачи (parse_excel/generate_ai_summary/cache_invalidate) регистрируются в своих доменах
и временно — в app.workers.tasks (shim), чтобы путь `-A app.workers.tasks.celery_app` работал.
"""
from celery import Celery

from app.infrastructure.config import settings

celery_app = Celery(
    "asok_is",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    task_track_started=True,
    result_expires=3600,
)
