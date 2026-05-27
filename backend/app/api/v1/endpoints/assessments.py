from collections import defaultdict
from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db
from app.models.assessment import AssessmentPeriod, AssessmentValue
from app.models.metric_catalog import MetricCatalog
from app.models.system import System
from app.schemas.assessment import (
    CalculatedMetricOut,
    EditableMetricIn,
    EditableMetricOut,
    PeriodCreate,
    PeriodOut,
)
from app.services.calculation_engine import calculate_metric, map_to_level
from app.services.excel_importer import ensure_period_values

router = APIRouter()


def _empty_dashboard() -> dict:
    return {
        "globalHealthScore": 0.0,
        "levelCounts": {},
        "heatmapData": [],
        "xAxisLabels": [],
        "yAxisLabels": [],
        "problematicSystems": [],
        "totalMetrics": 0,
    }


def _x_to_level(x: float) -> int:
    if x >= 0.81:
        return 5
    if x >= 0.61:
        return 4
    if x >= 0.41:
        return 3
    if x >= 0.21:
        return 2
    if x > 0:
        return 1
    return 0


@router.get("/dashboard")
async def get_dashboard(db: AsyncSession = Depends(get_db)):
    systems_result = await db.execute(
        select(System).where(System.is_active.is_(True), System.is_deleted.is_(False)).order_by(System.name)
    )
    systems = list(systems_result.scalars().all())
    if not systems:
        return _empty_dashboard()

    values_result = await db.execute(
        select(AssessmentValue, AssessmentPeriod, System, MetricCatalog)
        .join(AssessmentPeriod, AssessmentValue.period_id == AssessmentPeriod.id)
        .join(System, AssessmentPeriod.system_id == System.id)
        .join(MetricCatalog, AssessmentValue.metric_id == MetricCatalog.id)
        .where(
            System.is_active.is_(True),
            System.is_deleted.is_(False),
            AssessmentValue.calculated_x.isnot(None),
        )
        .order_by(AssessmentPeriod.created_at.desc(), AssessmentPeriod.period.desc())
    )
    rows = values_result.all()
    if not rows:
        return _empty_dashboard()

    latest_period_per_system: dict[str, str] = {}
    for _, period, system, _ in rows:
        sid = str(system.id)
        latest_period_per_system.setdefault(sid, str(period.id))

    latest_rows = [
        (value, period, system, metric)
        for value, period, system, metric in rows
        if latest_period_per_system.get(str(system.id)) == str(period.id)
    ]

    characteristics = sorted({metric.characteristic for _, _, _, metric in latest_rows})
    systems_with_values = [system for system in systems if str(system.id) in latest_period_per_system]
    system_names = [system.name for system in systems_with_values]
    characteristic_index = {name: index for index, name in enumerate(characteristics)}
    system_index = {system.id: index for index, system in enumerate(systems_with_values)}

    level_counts: dict[str, int] = defaultdict(int)
    heatmap_agg: dict[tuple[int, int], list[float]] = defaultdict(list)
    low_counts: dict[str, int] = defaultdict(int)
    all_scores: list[float] = []

    for value, _, system, metric in latest_rows:
        score = float(value.calculated_x)
        all_scores.append(score)
        level_counts[value.quality_level or map_to_level(score)] += 1
        heatmap_agg[(characteristic_index[metric.characteristic], system_index[system.id])].append(score)
        if score < 0.41:
            low_counts[str(system.id)] += 1

    heatmap_data = [
        [char_idx, sys_idx, _x_to_level(sum(scores) / len(scores))]
        for (char_idx, sys_idx), scores in heatmap_agg.items()
    ]

    systems_by_id = {str(system.id): system for system in systems}
    problematic = [
        {
            "id": sid,
            "name": system.name,
            "criticality": system.criticality_class.value
            if hasattr(system.criticality_class, "value")
            else str(system.criticality_class),
            "lowMetricsCount": count,
        }
        for sid, count in sorted(low_counts.items(), key=lambda item: item[1], reverse=True)[:10]
        if (system := systems_by_id.get(sid)) is not None
    ]

    return {
        "globalHealthScore": round(sum(all_scores) / len(all_scores), 4) if all_scores else 0.0,
        "levelCounts": dict(level_counts),
        "heatmapData": heatmap_data,
        "xAxisLabels": characteristics,
        "yAxisLabels": system_names,
        "problematicSystems": problematic,
        "totalMetrics": len(all_scores),
    }


@router.post("/periods", response_model=PeriodOut, status_code=status.HTTP_201_CREATED)
async def create_assessment_period(payload: PeriodCreate, db: AsyncSession = Depends(get_db)) -> AssessmentPeriod:
    system = await db.get(System, payload.system_id)
    if system is None or system.is_deleted:
        raise HTTPException(status_code=404, detail="System not found")

    existing = await db.execute(
        select(AssessmentPeriod).where(
            AssessmentPeriod.system_id == payload.system_id,
            AssessmentPeriod.period == payload.period,
        )
    )
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(status_code=409, detail="Assessment period already exists")

    period = AssessmentPeriod(system_id=payload.system_id, period=payload.period, status="DRAFT")
    db.add(period)
    await db.flush()
    await ensure_period_values(db, period)
    await db.commit()
    await db.refresh(period)
    return period


@router.get("/periods", response_model=list[PeriodOut])
async def list_assessment_periods(
    system_id: UUID | None = None,
    db: AsyncSession = Depends(get_db),
) -> list[AssessmentPeriod]:
    stmt = select(AssessmentPeriod).join(System).where(System.is_deleted.is_(False)).order_by(
        AssessmentPeriod.created_at.desc()
    )
    if system_id is not None:
        stmt = stmt.where(AssessmentPeriod.system_id == system_id)
    result = await db.execute(stmt)
    return list(result.scalars().all())


@router.get("/{period_id}/metrics", response_model=List[EditableMetricOut])
async def get_assessment_metrics(period_id: UUID, db: AsyncSession = Depends(get_db)):
    await _require_period(db, period_id)
    result = await db.execute(
        select(AssessmentValue, MetricCatalog)
        .join(MetricCatalog, AssessmentValue.metric_id == MetricCatalog.id)
        .where(AssessmentValue.period_id == period_id)
        .order_by(MetricCatalog.characteristic, MetricCatalog.id)
    )
    rows = result.all()

    return [
        EditableMetricOut(
            id=str(value.id),
            name=f"{metric.characteristic} / {metric.subcharacteristic}",
            description=metric.description or "",
            val_a=float(value.val_a) if value.val_a is not None else None,
            val_b=float(value.val_b) if value.val_b is not None else None,
            expert_comment=value.expert_comment or "",
            calculatedX=float(value.calculated_x) if value.calculated_x is not None else None,
            qualityLevel=value.quality_level,
        )
        for value, metric in rows
    ]


@router.put("/{period_id}/metrics")
async def save_assessment_metrics(
    period_id: UUID,
    metrics: List[EditableMetricIn],
    db: AsyncSession = Depends(get_db),
):
    await _require_period(db, period_id)
    updated = 0
    errors: list[str] = []

    for item in metrics:
        result = await db.execute(
            select(AssessmentValue, MetricCatalog)
            .join(MetricCatalog, AssessmentValue.metric_id == MetricCatalog.id)
            .where(AssessmentValue.id == item.id, AssessmentValue.period_id == period_id)
        )
        row = result.first()
        if not row:
            errors.append(f"Metric value id={item.id} not found")
            continue

        value, metric = row
        value.val_a = item.val_a
        value.val_b = item.val_b
        value.expert_comment = item.expert_comment
        if item.val_a is not None and item.val_b is not None:
            formula_type = metric.formula_type.value if hasattr(metric.formula_type, "value") else str(metric.formula_type)
            x = calculate_metric(item.val_a, item.val_b, formula_type)
            value.calculated_x = x
            value.quality_level = map_to_level(x)
        else:
            value.calculated_x = None
            value.quality_level = None
        updated += 1

    period = await db.get(AssessmentPeriod, period_id)
    if period is not None:
        period.status = "CALCULATED" if updated else period.status
    await db.commit()
    return {"status": "ok", "updated": updated, "errors": errors}


@router.get("/{period_id}/calculated", response_model=List[CalculatedMetricOut])
async def get_calculated_metrics(period_id: UUID, db: AsyncSession = Depends(get_db)):
    await _require_period(db, period_id)
    result = await db.execute(
        select(AssessmentValue, MetricCatalog)
        .join(MetricCatalog, AssessmentValue.metric_id == MetricCatalog.id)
        .where(
            AssessmentValue.period_id == period_id,
            AssessmentValue.calculated_x.isnot(None),
        )
        .order_by(MetricCatalog.characteristic, MetricCatalog.id)
    )
    rows = result.all()

    return [
        CalculatedMetricOut(
            id=str(value.id),
            name=f"{metric.characteristic} / {metric.subcharacteristic}",
            calculatedX=float(value.calculated_x),
            systemLevel=value.quality_level or map_to_level(float(value.calculated_x)),
            expertComment=value.expert_comment,
        )
        for value, metric in rows
    ]


async def _require_period(db: AsyncSession, period_id: UUID) -> AssessmentPeriod:
    period = await db.get(AssessmentPeriod, period_id)
    if period is None:
        raise HTTPException(status_code=404, detail="Assessment period not found")
    return period
