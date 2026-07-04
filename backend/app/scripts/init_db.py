import asyncio

from app.infrastructure.database import Base, engine, import_models

# Реестр моделей всех модулей (ТЗ v13) + легаси-модели аудита вне реестра.
import_models()
from app.models.audit import AuditLog, ExpertJudgment  # noqa: F401, E402


async def init_tables():
    async with engine.begin() as conn:
        print("🛠 Создаем таблицы в БД...")
        await conn.run_sync(Base.metadata.create_all)
        print("✅ Таблицы успешно созданы!")

if __name__ == "__main__":
    asyncio.run(init_tables())
