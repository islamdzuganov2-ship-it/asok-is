from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase
from app.core.config import settings

# Инициализация асинхронного движка SQLAlchemy 2.0
engine = create_async_engine(
    settings.DATABASE_URL, 
    echo=settings.DEMO_MODE,
    future=True
)

# Фабрика сессий
AsyncSessionLocal = async_sessionmaker(
    bind=engine, 
    class_=AsyncSession, 
    expire_on_commit=False, 
    autoflush=False
)

# Базовый класс для всех моделей
class Base(DeclarativeBase):
    pass