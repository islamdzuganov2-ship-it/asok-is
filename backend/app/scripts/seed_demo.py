import asyncio
import random
import uuid

from sqlalchemy import select

from app.infrastructure.database import AsyncSessionLocal
from app.modules.assessment.models import AssessmentPeriod, AssessmentValue
from app.modules.iam import User, get_password_hash
from app.modules.quality import MetricCatalog, calculate_metric, map_to_level
from app.modules.systems import CriticalityClass, System


async def seed_data() -> None:
    async with AsyncSessionLocal() as db:
        users_data = [
            {"username": "admin", "email": "admin@example.com", "password": "Admin123!", "role": "ADMIN"},
            {"username": "analyst", "email": "analyst@example.com", "password": "Analyst123!", "role": "TEST_ANALYST"},
            {"username": "manager", "email": "manager@example.com", "password": "Manager123!", "role": "QUALITY_MANAGER"},
        ]
        for item in users_data:
            result = await db.execute(select(User).where(User.username == item["username"]))
            if result.scalar_one_or_none() is None:
                db.add(
                    User(
                        username=item["username"],
                        email=item["email"],
                        password_hash=get_password_hash(item["password"]),
                        full_name=item["username"].title(),
                        role=item["role"],
                    )
                )

        systems_data = [
            {"name": "АБС Core", "code": "ABS_CORE", "criticality_class": CriticalityClass.MISSION_CRITICAL},
            {"name": "CRM ОПК", "code": "CRM_OPK", "criticality_class": CriticalityClass.BUSINESS_CRITICAL},
            {"name": "HR Portal", "code": "HR_PORTAL", "criticality_class": CriticalityClass.BUSINESS_OPERATIONAL},
        ]
        systems: list[System] = []
        for item in systems_data:
            result = await db.execute(select(System).where(System.code == item["code"]))
            system = result.scalar_one_or_none()
            if system is None:
                system = System(**item)
                db.add(system)
                await db.flush()
            systems.append(system)

        metrics = list((await db.execute(select(MetricCatalog).where(MetricCatalog.is_active.is_(True)))).scalars().all())
        if not metrics:
            await db.commit()
            return

        for system in systems:
            result = await db.execute(
                select(AssessmentPeriod).where(
                    AssessmentPeriod.system_id == system.id,
                    AssessmentPeriod.period == "Q2-2026",
                )
            )
            period = result.scalar_one_or_none()
            if period is None:
                period = AssessmentPeriod(system_id=system.id, period="Q2-2026", status="CALCULATED")
                db.add(period)
                await db.flush()

            for metric in metrics:
                exists = await db.execute(
                    select(AssessmentValue).where(
                        AssessmentValue.period_id == period.id,
                        AssessmentValue.metric_id == metric.id,
                    )
                )
                if exists.scalar_one_or_none() is not None:
                    continue

                base_b = 100
                formula_type = metric.formula_type.value if hasattr(metric.formula_type, "value") else str(metric.formula_type)
                val_a = random.randint(0, 35) if formula_type == "INVERSE" else random.randint(45, 100)
                calculated_x = calculate_metric(val_a, base_b, formula_type)
                db.add(
                    AssessmentValue(
                        id=uuid.uuid4(),
                        period_id=period.id,
                        metric_id=metric.id,
                        val_a=val_a,
                        val_b=base_b,
                        calculated_x=calculated_x,
                        quality_level=map_to_level(calculated_x),
                        data_source="AUTO_SEED",
                    )
                )

        await db.commit()


if __name__ == "__main__":
    asyncio.run(seed_data())
