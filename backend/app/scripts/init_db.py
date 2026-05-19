import asyncio
from app.core.database import engine, Base
# Импортируем все модели для их регистрации в Base
from app.models.user import User
from app.models.system import System
from app.models.assessment import AssessmentPeriod, AssessmentValue
from app.models.metric_catalog import MetricCatalog, MetricCharacteristic, MetricAttribute
from app.models.audit import ExpertJudgment

async def init_tables():
    async with engine.begin() as conn:
        print("🛠 Создаем таблицы в БД...")
        await conn.run_sync(Base.metadata.create_all)
        print("✅ Таблицы успешно созданы!")

if __name__ == "__main__":
    asyncio.run(init_tables())