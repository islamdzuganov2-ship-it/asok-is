```python
"""
Инициализация асинхронного движка SQLAlchemy 2.0 и фабрики сессий.
Используется asyncpg как драйвер для максимальной производительности.
Соответствует ТЗ п.2: SQLAlchemy 2.0 (Async mode).
"""
from sqlalchemy.ext.asyncio import (
    create_async_engine,
    AsyncSession,
    async_sessionmaker,
)
from sqlalchemy.orm import DeclarativeBase
from app.core.config import settings

_async_url = settings.DATABASE_URL.replace(
    "postgresql://", "postgresql+asyncpg://"
)

engine = create_async_engine(
    _async_url,
    echo=False,
    pool_size=20,
    max_overflow=10,
    pool_pre_ping=True,
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
    autocommit=False,
)


class Base(DeclarativeBase):
    """Базовый класс для всех ORM моделей проекта."""
    pass


async def get_db() -> AsyncSession:
    """
    FastAPI Dependency: предоставляет async сессию БД на время запроса.

    Yields:
        AsyncSession: активная сессия SQLAlchemy.
    """
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
```
