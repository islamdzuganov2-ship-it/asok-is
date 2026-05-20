"""
Асинхронное подключение к PostgreSQL. Умная замена префикса только при необходимости.
"""
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from app.core.config import settings

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

from app.db.base import Base  # noqa: F401, E402