from collections import defaultdict
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.models.assessment import AssessmentPeriod, AssessmentValue
from app.models.matrices import DefectMatrix, QualityPlanMatrix, RiskMatrix
from app.models.system import System
from app.schemas.assessment import (
    DashboardDataOut,
    DefectMatrixRow,
    FullExcelMatricesOut,
    ProblematicSystemOut,
    QualityPlanMatrixRow,
    RiskMatrixRow,
)

router = APIRouter()


@router.get("/assessment-period/{period_id}/matrices", response_model=FullExcelMatricesOut)
async def get_period_excel_matrices(
    period_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> FullExcelMatricesOut:
    period = await db.get(AssessmentPeriod, period_id)
    if period is None:
        raise HTTPException(status_code=404, detail="Assessment period not found")

    risks = list(
        (
            await db.execute(
                select(RiskMatrix).where(RiskMatrix.period_id == period_id).order_by(RiskMatrix.id)
            )
        )
        .scalars()
        .all()
    )
    defects = list(
        (
            await db.execute(
                select(DefectMatrix).where(DefectMatrix.period_id == period_id).order_by(DefectMatrix.id)
            )
        )
        .scalars()
        .all()
    )
    plans = list(
        (
            await db.execute(
                select(QualityPlanMatrix).where(QualityPlanMatrix.period_id == period_id).order_by(QualityPlanMatrix.id)
            )
        )
        .scalars()
        .all()
    )

    return FullExcelMatricesOut(
        period_id=period_id,
        risks=[
            RiskMatrixRow(
                characteristic=row.characteristic,
                subcharacteristic=row.subcharacteristic,
                risk_description=row.risk_description,
                risk_consequence=row.risk_consequence,
                mitigation_measures=row.mitigation_measures,
            )
            for row in risks
        ],
        defects=[
            DefectMatrixRow(
                id=row.id,
                characteristic=row.characteristic,
                digital_metric=row.digital_metric,
                quality_metric_level=row.quality_metric_level,
                defect_description=row.defect_description,
            )
            for row in defects
        ],
        plan=[
            QualityPlanMatrixRow(
                id=row.id,
                characteristic=row.characteristic,
                subcharacteristic=row.subcharacteristic,
                task_description=row.task_description,
                internal_document=row.internal_document,
                assignee_fio=row.assignee_fio,
                assignee_role=row.assignee_role,
                assignee_department=row.assignee_department,
                deadline=row.deadline,
                profile_executor=row.profile_executor,
                tech_debt_link=row.tech_debt_link,
            )
            for row in plans
        ],
    )


def _score_to_bucket(value: float | None) -> int:
    if value is None:
        return 0
    if value >= 0.81:
        return 5
    if value >= 0.61:
        return 4
    if value >= 0.41:
        return 3
    if value >= 0.21:
        return 2
    if value > 0:
        return 1
    return 0


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

    measured = [float(value.calculated_x) for value in values if value.calculated_x is not None]
    if not measured:
        return DashboardDataOut(
            globalHealthScore=0.0,
            aiInsights="Нет данных для расчета управленческой панели.",
            heatmapData=[],
            xAxisLabels=[],
            yAxisLabels=[],
            problematicSystems=[],
        )

    global_score = round((sum(measured) / len(measured)) * 100, 2)
    system_names = sorted({value.period.system.name for value in values})
    characteristic_names = sorted({value.metric.characteristic for value in values})
    system_index = {name: index for index, name in enumerate(system_names)}
    characteristic_index = {name: index for index, name in enumerate(characteristic_names)}

    cells: dict[tuple[str, str], list[float]] = defaultdict(list)
    low_counts: dict[UUID, int] = defaultdict(int)
    systems_by_id: dict[UUID, System] = {}
    for value in values:
        systems_by_id[value.period.system.id] = value.period.system
        if value.calculated_x is None:
            continue
        score = float(value.calculated_x)
        cells[(value.period.system.name, value.metric.characteristic)].append(score)
        if score < 0.41:
            low_counts[value.period.system.id] += 1

    heatmap = [
        [
            characteristic_index[characteristic],
            system_index[system_name],
            _score_to_bucket(sum(scores) / len(scores)),
        ]
        for (system_name, characteristic), scores in cells.items()
    ]

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
