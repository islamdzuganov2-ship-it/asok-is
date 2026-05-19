import asyncio
from app.core.database import engine, Base
# Импортируем все до единой модели
from app.models.user import User
from app.models.system import System
from app.models.metric_catalog import MetricCatalog, MetricCharacteristic, MetricAttribute
from app.models.assessment import AssessmentPeriod, AssessmentValue
from app.models.audit import ExpertJudgment
from app.models.base_mixin import BaseMixin 

async def init_tables():
    print("🛠 Создаем таблицы...")
    async with engine.begin() as conn:
        # Принудительно создаем структуру
        await conn.run_sync(Base.metadata.create_all)
    print("✅ Таблицы созданы!")

if __name__ == "__main__":
    asyncio.run(init_tables())