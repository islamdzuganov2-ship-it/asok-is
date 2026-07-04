"""
Сидер сквозной базы рисков (risk_base) — стартовый набор знаний для LLM-grounding.
Запуск: docker compose exec backend python -m app.scripts.seed_risk_base
"""
import asyncio
import os
import sys

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from app.infrastructure.database import Base, import_models
from app.modules.risk.models import RiskBase

import_models()  # полная Base.metadata для create_all

RISKS = [
    {
        "code": "R-TEST-001",
        "title": "Низкая автоматизация регрессионного тестирования",
        "category": "тестируемость",
        "characteristic": "Тестируемость",
        "subcharacteristic": "Автоматизация регрессионной модели",
        "description": "Покрытие автотестами регресса ниже целевого, регресс выполняется вручную.",
        "consequence": "Рост числа необнаруженных дефектов, удлинение релизного цикла.",
        "mitigation": "Выделить ресурс QA-автоматизации, приоритизировать критические сценарии, включить контроль покрытия в релизный гейт.",
        "severity": "high",
        "likelihood": "high",
        "keywords": "автотесты, регресс, покрытие, тест-кейсы, автоматизация",
    },
    {
        "code": "R-REL-001",
        "title": "Просадка по надёжности и сопровождаемости",
        "category": "надёжность",
        "characteristic": "Надежность",
        "subcharacteristic": "Доступность системы",
        "description": "Растёт частота инцидентов в пиковые окна, снижается доступность.",
        "consequence": "Нарушение SLA, репутационные и финансовые потери.",
        "mitigation": "Заморозить рискованные релизы, запустить программу стабилизации, усилить мониторинг.",
        "severity": "critical",
        "likelihood": "medium",
        "keywords": "надёжность, доступность, инциденты, SLA, стабильность",
    },
    {
        "code": "R-DATA-001",
        "title": "Недостаточный контроль качества данных",
        "category": "данные",
        "characteristic": "Тестируемость",
        "subcharacteristic": "Идентичность тестовых сред",
        "description": "Тестовые среды не идентичны продуктивной, контроль качества витрин данных слабый.",
        "consequence": "Дефекты данных доходят до продуктива, недостоверная отчётность.",
        "mitigation": "Приоритизировать покрытие критических витрин, включить контроль качества данных в релизный гейт.",
        "severity": "high",
        "likelihood": "medium",
        "keywords": "данные, витрины, тестовая среда, качество данных",
    },
    {
        "code": "R-SEC-001",
        "title": "Неполная реализация ролевой модели (RBAC)",
        "category": "безопасность",
        "characteristic": "Безопасность",
        "subcharacteristic": "Реализация ролевой модели",
        "description": "RBAC реализован частично, есть избыточные права доступа.",
        "consequence": "Риск несанкционированного доступа, замечания регулятора.",
        "mitigation": "Провести ревизию ролей, внедрить принцип минимальных привилегий, регулярный аудит доступов.",
        "severity": "high",
        "likelihood": "low",
        "keywords": "безопасность, RBAC, доступы, роли, аудит",
    },
]


async def seed_risk_base_async():
    database_url = os.getenv(
        "DATABASE_URL",
        "postgresql+asyncpg://asok_user:asok_pass123@postgres:5432/asok_is",
    )
    engine = create_async_engine(database_url, echo=False)
    async_session = sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    inserted = 0
    async with async_session() as session:
        for data in RISKS:
            exists = (await session.execute(
                select(RiskBase).where(RiskBase.code == data["code"])
            )).scalar_one_or_none()
            if exists:
                continue
            session.add(RiskBase(**data, source="manual", created_by="seed"))
            inserted += 1
        await session.commit()
    await engine.dispose()
    print(f"seed_risk_base: добавлено {inserted}, пропущено {len(RISKS) - inserted}")


if __name__ == "__main__":
    asyncio.run(seed_risk_base_async())
