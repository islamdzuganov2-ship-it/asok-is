import asyncio

from app.core.database import engine
from app.db.base import Base

# Import models so Base.metadata contains the complete schema.
from app.models.assessment import AssessmentPeriod, AssessmentValue, ExpertJudgmentHistory  # noqa: F401
from app.models.audit import AuditLog  # noqa: F401
from app.models.metric_catalog import MetricAttribute, MetricCatalog, MetricCharacteristic  # noqa: F401
from app.models.system import System  # noqa: F401
from app.models.user import User  # noqa: F401


async def init_tables() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


if __name__ == "__main__":
    asyncio.run(init_tables())
