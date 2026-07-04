import asyncio

from app.infrastructure.database import Base, engine, import_models

# Регистрируем модели всех модулей, чтобы Base.metadata содержал полную схему.
import_models()
from app.models.audit import AuditLog  # noqa: F401, E402  (легаси-модель вне реестра)


async def init_tables() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


if __name__ == "__main__":
    asyncio.run(init_tables())
