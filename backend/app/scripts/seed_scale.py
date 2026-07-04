"""
Заливка масштабного демо-датасета в БД («пролить моки в оценку»):
30 ИС × оценочный период × значения по всем метрикам каталога — для максимального
маппинга в режиме LLM (дашборды берут реальные данные из БД, а не фронтовые моки).

Идемпотентно: системы по коду, периоды по (system, period), значения по (period, metric).
Запуск: docker compose exec backend python -m app.scripts.seed_scale
"""
import asyncio
import os
import sys
from random import Random

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from app.infrastructure.database import Base, import_models
from app.modules.systems import System, CriticalityClass, LifecycleStatus
from app.modules.assessment.models import AssessmentPeriod, AssessmentValue
from app.modules.quality import MetricCatalog, calculate_metric, map_to_level
from app.scripts.seed_metrics import METRICS_DATA

import_models()  # полная Base.metadata для create_all

PERIOD = "Q2-2026"

SYSTEM_NAMES = [
    'АБС «Ядро»', 'ДБО Розница', 'ДБО Корпоратив', 'CRM ОПК', 'Единое хранилище данных (ЕХД)',
    'Systematica Radius', 'СЭД', 'Процессинг карт', 'Антифрод-платформа', 'Кредитный конвейер',
    'Скоринг-движок', 'Витрина отчётности', 'КХД Аналитика', 'Мобильный банк', 'Интернет-эквайринг',
    'Платёжный шлюз', 'АБС Казначейство', 'Депозитарий', 'Биллинг услуг', 'KYC/AML-модуль',
    'Бюро кредитных историй', 'Шина интеграции (ESB)', 'Портал самообслуживания', 'Контакт-центр',
    'HR-платформа', 'Документооборот ВНД', 'Риск-менеджмент', 'Бухгалтерия ГК', 'Архив долговременный',
    'Мониторинг ИТ (NOC)',
]
CRIT_CYCLE = [
    CriticalityClass.MISSION_CRITICAL,
    CriticalityClass.BUSINESS_CRITICAL,
    CriticalityClass.BUSINESS_OPERATIONAL,
]


def _clamp(v, lo, hi):
    return max(lo, min(hi, v))


async def seed_scale_async():
    database_url = os.getenv(
        "DATABASE_URL",
        "postgresql+asyncpg://asok_user:asok_pass123@postgres:5432/asok_is",
    )
    engine = create_async_engine(database_url, echo=False)
    async_session = sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with async_session() as db:
        # 1. Каталог метрик: если пуст — наполняем из seed_metrics.
        metrics = list((await db.execute(select(MetricCatalog))).scalars().all())
        if not metrics:
            for md in METRICS_DATA:
                db.add(MetricCatalog(**md))
            await db.commit()
            metrics = list((await db.execute(select(MetricCatalog))).scalars().all())

        systems_done = periods_done = values_done = 0

        for idx, name in enumerate(SYSTEM_NAMES):
            code = f"SYS-{idx + 1:02d}"
            system = (await db.execute(select(System).where(System.code == code))).scalar_one_or_none()
            if system is None:
                system = System(
                    name=name, code=code,
                    status_lc=LifecycleStatus.OE,
                    criticality_class=CRIT_CYCLE[idx % 3],
                    owner="Иванов И.И.",
                    is_active=True, is_deleted=False,
                )
                db.add(system)
                await db.flush()
                systems_done += 1

            period = (await db.execute(
                select(AssessmentPeriod).where(
                    AssessmentPeriod.system_id == system.id,
                    AssessmentPeriod.period == PERIOD,
                )
            )).scalar_one_or_none()
            if period is None:
                period = AssessmentPeriod(system_id=system.id, period=PERIOD, status="CALCULATED")
                db.add(period)
                await db.flush()
                periods_done += 1

            base = 0.32 + Random(hash(name) & 0xFFFFFFFF).random() * 0.58  # профиль здоровья ИС
            for m in metrics:
                exists = (await db.execute(
                    select(AssessmentValue).where(
                        AssessmentValue.period_id == period.id,
                        AssessmentValue.metric_id == m.id,
                    )
                )).scalar_one_or_none()
                if exists is not None:
                    continue
                rng = Random(hash(f"{name}|{m.id}") & 0xFFFFFFFF)
                x = _clamp(base + (rng.random() - 0.5) * 0.5, 0.05, 0.99)
                b = 20 + int(rng.random() * 480)
                ft = str(getattr(m.formula_type, "value", m.formula_type)).upper()
                a = round(b * x) if "INVERSE" not in ft else round(b * (1 - x))
                calc = calculate_metric(float(a), float(b), "INVERSE" if "INVERSE" in ft else "DIRECT")
                db.add(AssessmentValue(
                    period_id=period.id, metric_id=m.id,
                    val_a=a, val_b=b,
                    calculated_x=calc, quality_level=map_to_level(calc),
                    data_source="DEMO",
                ))
                values_done += 1

        await db.commit()
    await engine.dispose()
    print(f"seed_scale: систем +{systems_done}, периодов +{periods_done}, значений +{values_done}")


if __name__ == "__main__":
    asyncio.run(seed_scale_async())
