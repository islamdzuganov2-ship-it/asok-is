from collections import defaultdict
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.models.assessment import AssessmentPeriod, AssessmentValue
from app.models.metric_catalog import MetricCatalog
from app.models.system import System
from app.schemas.assessment import DashboardDataOut, ProblematicSystemOut

router = APIRouter()


def _score_to_bucket(value: float | None) -> int:
    if value is None:
        return 0
    return max(0, min(5, round(value * 5)))


@router.get("/executive-dashboard", response_model=DashboardDataOut)
async def get_executive_dashboard(db: AsyncSession = Depends(get_db)) -> DashboardDataOut:
    result = await db.execute(
        select(AssessmentValue)
        .options(
            selectinload(AssessmentValue.metric),
            selectinload(AssessmentValue.period).selectinload(AssessmentPeriod.system),
        )
        .join(AssessmentPeriod, AssessmentValue.period_id == AssessmentPeriod.id)
        .join(System, AssessmentPeriod.system_id == System.id)
        .where(System.is_deleted.is_(False), System.is_active.is_(True))
    )
    values = list(result.scalars().all())

    if not values:
        return DashboardDataOut(
            globalHealthScore=0.0,
            aiInsights="Нет данных для расчета управленческой панели.",
            heatmapData=[],
            xAxisLabels=[],
            yAxisLabels=[],
            problematicSystems=[],
        )

    measured = [float(v.calculated_x) for v in values if v.calculated_x is not None]
    global_score = round((sum(measured) / len(measured)) * 100, 2) if measured else 0.0

    system_names = sorted({v.period.system.name for v in values})
    characteristic_names = sorted({v.metric.characteristic for v in values})
    system_index = {name: idx for idx, name in enumerate(system_names)}
    characteristic_index = {name: idx for idx, name in enumerate(characteristic_names)}

    cells: dict[tuple[str, str], list[float]] = defaultdict(list)
    low_counts: dict[UUID, int] = defaultdict(int)
    systems_by_id: dict[UUID, System] = {}
    for value in values:
        systems_by_id[value.period.system.id] = value.period.system
        if value.calculated_x is not None:
            cells[(value.period.system.name, value.metric.characteristic)].append(float(value.calculated_x))
            if float(value.calculated_x) < 0.41:
                low_counts[value.period.system.id] += 1

    heatmap = []
    for (system_name, characteristic), scores in cells.items():
        average = sum(scores) / len(scores)
        heatmap.append(
            [
                characteristic_index[characteristic],
                system_index[system_name],
                _score_to_bucket(average),
            ]
        )

    problematic = [
        ProblematicSystemOut(
            id=system.id,
            name=system.name,
            criticality=system.criticality_class.value
            if hasattr(system.criticality_class, "value")
            else str(system.criticality_class),
            lowMetricsCount=count,
        )
        for system_id, count in sorted(low_counts.items(), key=lambda item: item[1], reverse=True)
        if (system := systems_by_id.get(system_id)) is not None
    ][:10]

    return DashboardDataOut(
        globalHealthScore=global_score,
        aiInsights=f"Средний интегральный показатель качества составляет {global_score}%.",
        heatmapData=heatmap,
        xAxisLabels=characteristic_names,
        yAxisLabels=system_names,
        problematicSystems=problematic,
    )
