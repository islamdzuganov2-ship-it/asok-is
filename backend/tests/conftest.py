# backend/tests/conftest.py
import sys
import os
import pytest
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from fastapi.testclient import TestClient

# Добавляем корень проекта в PYTHONPATH
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.main import app
from app.infrastructure.database import Base

@pytest.fixture(scope="session")
def anyio_backend():
    return "asyncio"


@pytest.fixture(autouse=True)
def _isolate_llm_brain(tmp_path, monkeypatch):
    """Изоляция «резервного мозга» LLM в temp-каталог на каждый тест.

    Иначе brain.remember() писал бы JSONL в репозиторий, а brain.recall() читал бы чужую
    память между прогонами (недетерминизм). Каталог сбрасывается автоматически (tmp_path).
    """
    from app.infrastructure.config import settings
    monkeypatch.setattr(settings, "LLM_BRAIN_DIR", str(tmp_path / "llm_brain"))

@pytest.fixture(scope="session")
def test_database_url():
    """URL тестовой БД (можно переопределить через env)"""
    return os.getenv(
        "TEST_DATABASE_URL",
        "postgresql+asyncpg://asok_user:asok_secure_password_123@postgres:5432/asok_is_test"
    )

@pytest.fixture(scope="function")
async def engine(test_database_url: str):
    """Async engine для тестов (function-scope: свой event loop на каждый тест —
    иначе session-scoped пул привязан к loop первого теста → InterfaceError)."""
    eng = create_async_engine(test_database_url, echo=False)
    yield eng
    await eng.dispose()

@pytest.fixture(scope="function")
async def db_session(engine):
    """Fresh DB session for each test with rollback"""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    
    async_session = sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
    
    async with async_session() as session:
        yield session
        await session.rollback()
    
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)

@pytest.fixture(scope="function")
def client(db_session):
    """TestClient с внедрённой тестовой сессией БД"""
    def override_get_db():
        yield db_session
    
    app.dependency_overrides = {}  # Сброс оверрайдов между тестами
    with TestClient(app) as c:
        yield c
    app.dependency_overrides = {}