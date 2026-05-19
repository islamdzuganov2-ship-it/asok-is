"""
Прокси-функция для получения асинхронной сессии (используется репозиториями).
"""
from app.core.database import AsyncSessionLocal

async def get_session():
    """Возвращает сессию БД."""
    async with AsyncSessionLocal() as session:
        yield session