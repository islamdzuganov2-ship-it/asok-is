"""
Сид каталога метрик по модели качества ИС (ISO/IEC 25010): 31 пара
характеристика × подхарактеристика. Приводит MetricCatalog к эталонной модели,
используемой вкладкой «Оценка ИС».

Идемпотентно: пара ищется по (characteristic, subcharacteristic); существующая
обновляется (formula_type, is_active), отсутствующая — создаётся.

Запуск: docker compose exec backend python -m app.scripts.seed_iso25010
"""
import asyncio

from sqlalchemy import select, text

from app.constants.quality_model import QUALITY_MODEL
from app.core.database import AsyncSessionLocal
from app.models.metric_catalog import FormulaType, MetricCatalog


async def seed_iso25010_async() -> dict[str, int]:
    created = 0
    updated = 0
    async with AsyncSessionLocal() as db:
        # Каталог мог быть засеян с явными id (seed_metrics), из-за чего sequence
        # отстаёт от MAX(id) и INSERT новых пар даёт duplicate key. Синхронизируем.
        await db.execute(text(
            "SELECT setval(pg_get_serial_sequence('metric_catalog', 'id'), "
            "GREATEST(COALESCE((SELECT MAX(id) FROM metric_catalog), 1), 1))"
        ))
        for characteristic, subs in QUALITY_MODEL:
            for subcharacteristic, formula in subs:
                formula_type = FormulaType(formula)
                result = await db.execute(
                    select(MetricCatalog).where(
                        MetricCatalog.characteristic == characteristic,
                        MetricCatalog.subcharacteristic == subcharacteristic,
                    )
                )
                metric = result.scalar_one_or_none()
                description = f"{characteristic} / {subcharacteristic} (ISO/IEC 25010)"
                if metric is None:
                    db.add(
                        MetricCatalog(
                            characteristic=characteristic,
                            subcharacteristic=subcharacteristic,
                            formula_type=formula_type,
                            description=description,
                            data_source="ISO25010",
                            is_active=True,
                        )
                    )
                    created += 1
                else:
                    metric.formula_type = formula_type
                    metric.is_active = True
                    if not metric.description:
                        metric.description = description
                    updated += 1
        await db.commit()

    total = created + updated
    print(f"✅ ISO/IEC 25010: {total} пар в каталоге (создано {created}, обновлено {updated})")
    return {"created": created, "updated": updated, "total": total}


def seed_iso25010() -> None:
    asyncio.run(seed_iso25010_async())


if __name__ == "__main__":
    seed_iso25010()
