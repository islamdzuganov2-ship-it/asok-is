from decimal import Decimal
from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.assessment import (
    AssessmentPeriod,
    AssessmentValue,
    ExpertJudgmentHistory,
)
from app.models.metric_catalog import MetricCatalog
from app.schemas.assessment import (
    CalculatedMetricOut,
    EditableMetricIn,
    EditableMetricOut,
    ExpertJudgmentCreate,
    PeriodCreate,
    PeriodOut,
    PeriodUpdate,
    ValueCreate,
    ValueOut,
)
from app.services.calculation_engine import calculate_metric, map_to_level

router = APIRouter()


def _to_float(value: object) -> float | None:
    if value is None:
        return None
    if isinstance(value, Decimal):
        return float(value)
    return float(value)


def _metric_name(metric: MetricCatalog) -> str:
    return f"{metric.characteristic}: {metric.subcharacteristic}"


def _calculate_value(value: AssessmentValue, metric: MetricCatalog) -> None:
    if value.val_a is None or value.val_b is None:
        value.calculated_x = None
        value.quality_level = None
        return

    formula_type = metric.formula_type.value if hasattr(metric.formula_type, "value") else str(metric.formula_type)
    calculated_x = calculate_metric(float(value.val_a), float(value.val_b), formula_type)
    value.calculated_x = calculated_x
    value.quality_level = map_to_level(calculated_x)


@router.get("/periods", response_model=List[PeriodOut])
async def get_all_periods(db: AsyncSession = Depends(get_db)) -> list[AssessmentPeriod]:
    result = await db.execute(
        select(AssessmentPeriod).order_by(AssessmentPeriod.created_at.desc())
    )
    return list(result.scalars().all())


@router.post("/periods", response_model=PeriodOut, status_code=status.HTTP_201_CREATED)
async def create_period(
    period_data: PeriodCreate,
    db: AsyncSession = Depends(get_db),
) -> AssessmentPeriod:
    existing = await db.execute(
        select(AssessmentPeriod).where(
            AssessmentPeriod.system_id == period_data.system_id,
            AssessmentPeriod.period == period_data.period,
        )
    )
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(status_code=409, detail="Assessment period already exists")

    period = AssessmentPeriod(**period_data.model_dump(), status="DRAFT")
    db.add(period)
    await db.flush()

    metrics = await db.execute(
        select(MetricCatalog).where(MetricCatalog.is_active.is_(True)).order_by(MetricCatalog.id)
    )
    for metric in metrics.scalars().all():
        db.add(AssessmentValue(period_id=period.id, metric_id=metric.id, data_source="MANUAL"))

    await db.commit()
    await db.refresh(period)
    return period


@router.put("/periods/{period_id}", response_model=PeriodOut)
async def update_period(
    period_id: UUID,
    period_data: PeriodUpdate,
    db: AsyncSession = Depends(get_db),
) -> AssessmentPeriod:
    result = await db.execute(
        update(AssessmentPeriod)
        .where(AssessmentPeriod.id == period_id)
        .values(**period_data.model_dump(exclude_unset=True))
        .returning(AssessmentPeriod)
    )
    updated_period = result.scalar_one_or_none()
    if updated_period is None:
        raise HTTPException(status_code=404, detail="Assessment period not found")
    await db.commit()
    return updated_period


@router.delete("/periods/{period_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_period(period_id: UUID, db: AsyncSession = Depends(get_db)) -> None:
    result = await db.execute(delete(AssessmentPeriod).where(AssessmentPeriod.id == period_id))
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Assessment period not found")
    await db.commit()


@router.get("/values", response_model=List[ValueOut])
async def get_all_values(db: AsyncSession = Depends(get_db)) -> list[AssessmentValue]:
    result = await db.execute(select(AssessmentValue).order_by(AssessmentValue.created_at.desc()))
    return list(result.scalars().all())


@router.post("/values", response_model=ValueOut, status_code=status.HTTP_201_CREATED)
async def create_value(
    value_data: ValueCreate,
    db: AsyncSession = Depends(get_db),
) -> AssessmentValue:
    metric = await db.get(MetricCatalog, value_data.metric_id)
    if metric is None:
        raise HTTPException(status_code=404, detail="Metric not found")

    value = AssessmentValue(**value_data.model_dump())
    _calculate_value(value, metric)
    db.add(value)
    await db.commit()
    await db.refresh(value)
    return value


@router.get("/{period_id}/metrics", response_model=list[EditableMetricOut])
async def get_assessment_metrics(
    period_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> list[EditableMetricOut]:
    result = await db.execute(
        select(AssessmentValue)
        .options(selectinload(AssessmentValue.metric))
        .where(AssessmentValue.period_id == period_id)
        .join(MetricCatalog, AssessmentValue.metric_id == MetricCatalog.id)
        .order_by(MetricCatalog.id)
    )
    values = result.scalars().all()
    if not values:
        period = await db.get(AssessmentPeriod, period_id)
        if period is None:
            raise HTTPException(status_code=404, detail="Assessment period not found")

    return [
        EditableMetricOut(
            id=str(value.id),
            name=_metric_name(value.metric),
            description=value.metric.description or "",
            val_a=_to_float(value.val_a),
            val_b=_to_float(value.val_b),
            expert_comment=value.expert_comment or "",
        )
        for value in values
    ]


@router.put("/{period_id}/metrics", response_model=list[EditableMetricOut])
async def save_assessment_metrics(
    period_id: UUID,
    metrics: list[EditableMetricIn],
    db: AsyncSession = Depends(get_db),
) -> list[EditableMetricOut]:
    period = await db.get(AssessmentPeriod, period_id)
    if period is None:
        raise HTTPException(status_code=404, detail="Assessment period not found")

    value_ids = [UUID(metric.id) for metric in metrics]
    result = await db.execute(
        select(AssessmentValue)
        .options(selectinload(AssessmentValue.metric))
        .where(AssessmentValue.period_id == period_id, AssessmentValue.id.in_(value_ids))
    )
    values_by_id = {str(value.id): value for value in result.scalars().all()}

    if len(values_by_id) != len(metrics):
        raise HTTPException(status_code=400, detail="Payload contains metrics outside this period")

    for item in metrics:
        value = values_by_id[item.id]
        value.val_a = item.val_a
        value.val_b = item.val_b
        value.expert_comment = item.expert_comment
        _calculate_value(value, value.metric)

    period.status = "CALCULATED"
    await db.commit()

    return await get_assessment_metrics(period_id, db)


@router.get("/{period_id}/calculated", response_model=list[CalculatedMetricOut])
async def get_calculated_metrics(
    period_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> list[CalculatedMetricOut]:
    result = await db.execute(
        select(AssessmentValue)
        .options(selectinload(AssessmentValue.metric))
        .where(AssessmentValue.period_id == period_id)
        .join(MetricCatalog, AssessmentValue.metric_id == MetricCatalog.id)
        .order_by(MetricCatalog.id)
    )
    values = result.scalars().all()
    if not values and await db.get(AssessmentPeriod, period_id) is None:
        raise HTTPException(status_code=404, detail="Assessment period not found")

    return [
        CalculatedMetricOut(
            id=str(value.id),
            name=_metric_name(value.metric),
            calculatedX=round((_to_float(value.calculated_x) or 0.0) * 100, 2),
            systemLevel=value.quality_level or "Not measured",
            adjustedLevel=None,
            expertComment=value.expert_comment,
        )
        for value in values
    ]


@router.post("/expert-judgment", status_code=status.HTTP_204_NO_CONTENT)
async def submit_expert_judgment(
    payload: ExpertJudgmentCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
) -> None:
    value_id = UUID(payload.metricId)
    value = await db.get(AssessmentValue, value_id)
    if value is None:
        raise HTTPException(status_code=404, detail="Assessment value not found")

    user_id = current_user.get("id")
    if current_user.get("username") == "demo":
        created_by = None
    else:
        try:
            created_by = UUID(str(user_id))
        except (TypeError, ValueError):
            created_by = None

    db.add(
        ExpertJudgmentHistory(
            assessment_value_id=value.id,
            original_level=payload.calculatedLevel,
            adjusted_level=payload.adjustedLevel,
            justification_text=payload.justificationText,
            linked_risk_task=payload.linkedRiskTask,
            created_by=created_by,
        )
    )
    if payload.adjustedLevel:
        value.quality_level = payload.adjustedLevel
    value.expert_comment = payload.justificationText
    await db.commit()
