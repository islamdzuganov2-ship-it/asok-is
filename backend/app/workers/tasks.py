"""
Celery-задачи АСОК ИС — транзитный модуль strangler-миграции (ТЗ v13).

celery_app живёт в app.infrastructure.workers; доменные задачи разъехались по модулям
(parse_excel → modules/dataio, generate_ai_summary → modules/llm). Здесь всё
РЕ-ЭКСПОРТИРУЕТСЯ, чтобы путь `-A app.workers.tasks.celery_app` (docker-compose)
продолжал работать и все задачи регистрировались у воркера.
"""
import logging

from app.infrastructure.redis import get_redis
from app.infrastructure.workers import celery_app  # noqa: F401  (re-export для -A ...tasks.celery_app)
from app.modules.dataio.tasks import parse_excel_task  # noqa: F401  (регистрация задачи dataio)
from app.modules.llm.tasks import generate_ai_summary_task  # noqa: F401  (регистрация задачи llm)

logger = logging.getLogger(__name__)


@celery_app.task(name="tasks.cache_invalidate")
def cache_invalidate_task(pattern: str) -> dict:
    """Инвалидация Redis кэша по паттерну ключей."""
    r = get_redis(decode_responses=True)
    keys = r.keys(pattern)
    deleted = r.delete(*keys) if keys else 0
    logger.info("cache_invalidate: удалено %d ключей по %r", deleted, pattern)
    return {"deleted_keys": deleted}
