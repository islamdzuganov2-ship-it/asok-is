"""
Celery-приложение — каноническое место (ТЗ v13). Брокер и бекенд результатов: Redis.

Задачи (parse_excel/generate_ai_summary/cache_invalidate/llm_selfcheck) регистрируются
в своих доменах и временно — в app.workers.tasks (shim), чтобы путь
`-A app.workers.tasks.celery_app` работал.

Расписание (ТЗ v18 п.10): планировщик встроен в воркер (`celery worker --beat`), отдельный
контейнер beat не поднимается — воркер в стенде ровно один, и разносить их значило бы
добавить шестой контейнер ради одной задачи. При масштабировании на несколько воркеров
beat нужно вынести в отдельный процесс, иначе расписание сработает столько раз, сколько
воркеров запущено.
"""
from celery import Celery
from celery.schedules import crontab

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
    timezone=settings.SCHEDULE_TIMEZONE,
    enable_utc=True,
    beat_schedule={
        # Еженедельная самооценка LLM-подсистемы по ISO/IEC 25010.
        # Понедельник, ночь: прогон с инференсом нагружает CPU на минуты, и делать это
        # в рабочие часы, когда пользователи ждут заключений, нельзя (llama.cpp сериализует
        # инференс — самооценка блокировала бы дашборды).
        "llm-selfcheck-weekly": {
            "task": "tasks.llm_selfcheck",
            "schedule": crontab(hour=3, minute=30, day_of_week=1),
            "kwargs": {"mode": "full", "trigger": "schedule"},
        },
        # ТЗ v19 §17.4 (УК-49): снимок Ц_ОМ фиксируется один раз при первой просрочке, текущее
        # значение пересчитывается каждую ночь — лёгкие агрегатные запросы, не требуют инференса.
        "governance-price-of-inaction-daily": {
            "task": "tasks.recompute_price_of_inaction",
            "schedule": crontab(hour=2, minute=0),
        },
        # ТЗ v19 §17.9 (УК-59/60): автоэскалация по SLA (минор 30 дней / критично 3 дня).
        "nonconformity-sla-autoescalate-daily": {
            "task": "tasks.nonconformity_sla_autoescalate",
            "schedule": crontab(hour=2, minute=15),
        },
    },
)
