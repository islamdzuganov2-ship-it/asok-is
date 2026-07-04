import asyncio

from sqlalchemy import select

from app.infrastructure.database import AsyncSessionLocal
from app.modules.assessment.models import AssessmentPeriod, AssessmentValue
from app.modules.quality import FormulaType, MetricCatalog, map_to_level
from app.modules.systems import CriticalityClass, LifecycleStatus, System


PERIODS = ["3Q 2024", "4Q 2024", "1Q 2025", "2Q 2025", "3Q 2025", "4Q 2025"]

ROWS = [
    ("Сводный показатель", "Текущий уровень качества", [0.54, 0.35, 0.51, 0.29, 0.44, 0.54]),
    ("Функциональная", "Функциональное", [0, 0, 0, 0, 0, 0]),
    ("Совместимость", "Совместимость", [0, 0, 0, 0, 0.76, 0.82]),
    ("Надежность", "Коррекция ошибок", [0, 1, 1, 0.7, 0.78, 0.81]),
    ("Надежность", "Доступность", [1, 0.8, 0.8, 0.8, 0.95, 0.89]),
    ("Надежность", "Среднее время", [None, 0, 0, 0, 0.06, 0.02]),
    ("Надежность", "Полнота резервной копии", [0.92, 1, 1, 0.8, 0.96, 1]),
    ("Пригодность для обслуживания", "Модифицируемость", [0, 0, 0.2, 0.1, 0.11, 0.25]),
    ("Пригодность для обслуживания", "Разделение компонентов", [0, 0, 0, 0, 1, 1]),
    ("Пригодность для обслуживания", "Корректность релизов", [0.55, 1, 1, 0.8, None, None]),
    ("Пригодность для обслуживания", "Корректность плановых", [None, None, None, None, 0.5, 0.33]),
    ("Пригодность для обслуживания", "Корректность срочных", [None, None, None, None, 0.81, 1]),
    ("Пригодность для обслуживания", "Мониторинг бизнес-", [None, 0, 0, 0, 0, 0]),
    ("Пригодность для обслуживания", "Мониторинг серверов", [1, 0.4, 1, 0.8, 1, 1]),
    ("Тестируемость", "Автоматизация", [0, 0, 0.08, 0.08, 0.08, 0.08]),
    ("Тестируемость", "Автономность", [0, 0, 0, 0, 0, 0]),
    ("Тестируемость", "ПОЛНОТА ВИДОВ", [1, 0.8, 1, 0.6, 0.63, 1]),
    ("Тестируемость", "Идентичность", [0, 0, 1, 0.9, 0.98, 0.98]),
    ("Тестируемость", "Состав тест и препрод", [None, 1, 1, 1, 1, 1]),
    ("Переносимость", "Время установки Релиза", [0.9, 1, 1, 0, 0, 0]),
    ("Эффективность. Показатели", "Средняя пропускная", [0, 0, 0, 0, 0, 0]),
    ("ЭФФЕКТИВНОСТЬ", "КОРРЕКТНОСТЬ ВРЕМЕНИ", [0, 0, 0, 0, 0, 0]),
    ("Безопасность. Показатели аутентификации", "Корректность механизма", [None, 0, 0, 0, 0, 1]),
    ("Безопасность. Показатели аутентификации", "Соответствие правил", [None, 0, 1, 0, 0, 1]),
    ("Удобство использования. Показатели полноты", "Реализация ролевой", [None, None, 0, 0, 0.89, 0.89]),
    ("Удобство использования. Показатели полноты", "Полнота описания", [None, 0, 0, 0, 0, 0]),
]


async def get_or_create_system() -> System:
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(System).where(System.name == "Корп", System.is_deleted.is_(False)))
        system = result.scalar_one_or_none()
        if system is None:
            result = await db.execute(select(System).where(System.code == "KORP"))
            system = result.scalar_one_or_none()
        if system is None:
            system = System(
                name="Корп",
                code="KORP",
                status_lc=LifecycleStatus.OE,
                criticality_class=CriticalityClass.BUSINESS_OPERATIONAL,
                owner="Импорт из таблицы качества",
                is_active=True,
            )
            db.add(system)
            await db.commit()
            await db.refresh(system)
        return system


async def seed_korp_quality() -> None:
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(System).where(System.name == "Корп", System.is_deleted.is_(False)))
        system = result.scalar_one_or_none()
        if system is None:
            result = await db.execute(select(System).where(System.code == "KORP"))
            system = result.scalar_one_or_none()
        if system is None:
            system = System(
                name="Корп",
                code="KORP",
                status_lc=LifecycleStatus.OE,
                criticality_class=CriticalityClass.BUSINESS_OPERATIONAL,
                owner="Импорт из таблицы качества",
                is_active=True,
            )
            db.add(system)
            await db.flush()

        periods: dict[str, AssessmentPeriod] = {}
        for label in PERIODS:
            result = await db.execute(
                select(AssessmentPeriod).where(
                    AssessmentPeriod.system_id == system.id,
                    AssessmentPeriod.period == label,
                )
            )
            period = result.scalar_one_or_none()
            if period is None:
                period = AssessmentPeriod(system_id=system.id, period=label, status="CALCULATED")
                db.add(period)
                await db.flush()
            else:
                period.status = "CALCULATED"
            periods[label] = period

        for characteristic, subcharacteristic, values in ROWS:
            result = await db.execute(
                select(MetricCatalog).where(
                    MetricCatalog.characteristic == characteristic,
                    MetricCatalog.subcharacteristic == subcharacteristic,
                )
            )
            metric = result.scalar_one_or_none()
            if metric is None:
                metric = MetricCatalog(
                    characteristic=characteristic,
                    subcharacteristic=subcharacteristic,
                    formula_type=FormulaType.DIRECT,
                    description="Импортировано из приложенной таблицы качества системы Корп",
                    data_source="ATTACHED_TABLE",
                    is_active=True,
                )
                db.add(metric)
                await db.flush()

            for label, score in zip(PERIODS, values):
                period = periods[label]
                result = await db.execute(
                    select(AssessmentValue).where(
                        AssessmentValue.period_id == period.id,
                        AssessmentValue.metric_id == metric.id,
                    )
                )
                assessment_value = result.scalar_one_or_none()
                if assessment_value is None:
                    assessment_value = AssessmentValue(period_id=period.id, metric_id=metric.id)
                    db.add(assessment_value)

                if score is None:
                    assessment_value.val_a = None
                    assessment_value.val_b = None
                    assessment_value.calculated_x = None
                    assessment_value.quality_level = None
                else:
                    assessment_value.val_a = round(score * 100, 2)
                    assessment_value.val_b = 100
                    assessment_value.calculated_x = round(score, 4)
                    assessment_value.quality_level = map_to_level(score)
                assessment_value.data_source = "ATTACHED_TABLE"

        await db.commit()
        print(f"Loaded {len(ROWS)} rows x {len(PERIODS)} periods for system Корп")


if __name__ == "__main__":
    asyncio.run(seed_korp_quality())
