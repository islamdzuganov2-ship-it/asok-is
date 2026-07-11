"""
Инфраструктура БД — каноническое место (ТЗ v13):
async engine, AsyncSessionLocal, get_db, ЕДИНЫЙ declarative Base и реестр моделей.

Обратная совместимость: app.core.database и app.db.base — re-export shims отсюда.
ВАЖНО: Base здесь — ровно один на всё приложение; раскол на два Base расколол бы
metadata и «спрятал» бы часть таблиц от Alembic/create_all.
"""
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase

from app.infrastructure.config import settings

# Умная замена префикса только при необходимости (psycopg2 URL → asyncpg).
_db_url = settings.DATABASE_URL
if "postgresql://" in _db_url and "asyncpg" not in _db_url:
    _db_url = _db_url.replace("postgresql://", "postgresql+asyncpg://")

engine = create_async_engine(
    _db_url,
    echo=False,
    future=True,
    pool_size=10,
    max_overflow=20,
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    expire_on_commit=False,
    autoflush=False,
    autocommit=False,
)


class Base(DeclarativeBase):
    """Единый declarative Base — одна metadata на всё приложение."""
    pass


async def get_db():
    """FastAPI-зависимость для получения сессии БД."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


def import_models() -> None:
    """Импортирует все ORM-модули, чтобы модели попали в Base.metadata (идемпотентно).

    Импортируются МОДУЛИ (а не имена классов) — это безопасно при частичной инициализации
    во время strangler-миграции: модели пока импортируют Base через shim app.db.base, и
    вызов из этого shim может произойти, когда одна из моделей ещё «в процессе» импорта.
    По мере переезда доменов список заменяется на app.modules.<domain>.models.
    """
    import app.modules.iam.models     # noqa: F401  (мигрирован в modules/iam)
    import app.modules.systems.models # noqa: F401  (мигрирован в modules/systems)
    import app.modules.quality.models # noqa: F401  (мигрирован в modules/quality)
    import app.modules.assessment.models  # noqa: F401  (мигрирован в modules/assessment)
    import app.modules.reporting.models    # noqa: F401  (мигрирован в modules/reporting)
    import app.modules.risk.models    # noqa: F401  (мигрирован в modules/risk)
    import app.modules.governance.models  # noqa: F401  (governance-петля в БД, T-10)
    import app.modules.incidents.models  # noqa: F401  (аналитика техсбоев, T-21)
