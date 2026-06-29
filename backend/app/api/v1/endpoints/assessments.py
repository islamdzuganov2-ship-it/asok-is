from collections import defaultdict
from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db, require_role
from app.constants.quality_model import QUALITY_PAIR_KEYS, TOTAL_SUBS
from app.models.assessment import AssessmentPeriod, AssessmentValue
from app.models.metric_catalog import FormulaType, MetricCatalog
from app.models.system import System
from app.schemas.assessment import (
    CalculatedMetricOut,
    EditableMetricIn,
    EditableMetricOut,
    PeriodCreate,
    PeriodOut,
    PeriodSummaryOut,
    ValueAddIn,
)
from app.services.calculation_engine import calculate_metric, map_to_level
from app.services.excel_importer import ensure_period_values, get_or_create_metric

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


@router.get("/periods/summary", response_model=list[PeriodSummaryOut])
async def list_period_summaries(
    system_id: UUID | None = None,
    db: AsyncSession = Depends(get_db),
) -> list[PeriodSummaryOut]:
    """Сводка по периодам: сколько подхарактеристик модели заполнено и полна ли оценка.

    Считаются только пары из эталонной модели (QUALITY_PAIR_KEYS) с рассчитанным X —
    легаси-метрики каталога в полноту не попадают.
    """
    stmt = (
        select(AssessmentPeriod, System)
        .join(System, AssessmentPeriod.system_id == System.id)
        .where(System.is_deleted.is_(False))
        .order_by(AssessmentPeriod.created_at.desc())
    )
    if system_id is not None:
        stmt = stmt.where(AssessmentPeriod.system_id == system_id)
    rows = (await db.execute(stmt)).all()
    if not rows:
        return []

    period_ids = [period.id for period, _ in rows]
    value_rows = (
        await db.execute(
            select(
                AssessmentValue.period_id,
                MetricCatalog.characteristic,
                MetricCatalog.subcharacteristic,
            )
            .join(MetricCatalog, AssessmentValue.metric_id == MetricCatalog.id)
            .where(
                AssessmentValue.period_id.in_(period_ids),
                AssessmentValue.calculated_x.isnot(None),
            )
        )
    ).all()

    filled: dict[UUID, set[tuple[str, str]]] = defaultdict(set)
    for period_id, characteristic, subcharacteristic in value_rows:
        if (characteristic, subcharacteristic) in QUALITY_PAIR_KEYS:
            filled[period_id].add((characteristic, subcharacteristic))

    return [
        PeriodSummaryOut(
            id=period.id,
            system_id=system.id,
            system_name=system.name,
            period=period.period,
            status=period.status,
            filled=len(filled.get(period.id, set())),
            total=TOTAL_SUBS,
            complete=len(filled.get(period.id, set())) >= TOTAL_SUBS,
        )
        for period, system in rows
    ]


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
            characteristic=metric.characteristic,
            subcharacteristic=metric.subcharacteristic,
            metric_id=metric.id,
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


@router.post("/{period_id}/values", response_model=EditableMetricOut, status_code=status.HTTP_201_CREATED)
async def add_assessment_value(
    period_id: UUID,
    payload: ValueAddIn,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_role("TEST_ANALYST", "QUALITY_MANAGER", "ADMIN")),
) -> EditableMetricOut:
    """Добавить/заполнить оценку для пары (характеристика, подхарактеристика) в периоде.

    Метрика каталога находится или создаётся по паре; значение для (период, метрика)
    находится или создаётся; X и уровень пересчитываются. Поддерживает бэкофилл пропущенных строк.
    """
    await _require_period(db, period_id)
    formula = FormulaType(payload.formula_type) if payload.formula_type else FormulaType.DIRECT
    metric, _created = await get_or_create_metric(
        db,
        characteristic=payload.characteristic.strip(),
        subcharacteristic=payload.subcharacteristic.strip(),
        formula_type=formula,
        data_source="ASSESSMENT_UI",
    )

    result = await db.execute(
        select(AssessmentValue).where(
            AssessmentValue.period_id == period_id,
            AssessmentValue.metric_id == metric.id,
        )
    )
    value = result.scalar_one_or_none()
    if value is None:
        value = AssessmentValue(period_id=period_id, metric_id=metric.id, data_source="MANUAL")
        db.add(value)

    value.val_a = payload.val_a
    value.val_b = payload.val_b
    value.expert_comment = (payload.expert_comment or "").strip() or None
    if payload.val_a is not None and payload.val_b is not None:
        formula_type = metric.formula_type.value if hasattr(metric.formula_type, "value") else str(metric.formula_type)
        x = calculate_metric(float(payload.val_a), float(payload.val_b), formula_type)
        value.calculated_x = x
        value.quality_level = map_to_level(x)
    else:
        value.calculated_x = None
        value.quality_level = None
    value.data_source = "MANUAL"

    await db.commit()
    await db.refresh(value)
    return EditableMetricOut(
        id=str(value.id),
        name=f"{metric.characteristic} / {metric.subcharacteristic}",
        characteristic=metric.characteristic,
        subcharacteristic=metric.subcharacteristic,
        metric_id=metric.id,
        description=metric.description or "",
        val_a=float(value.val_a) if value.val_a is not None else None,
        val_b=float(value.val_b) if value.val_b is not None else None,
        expert_comment=value.expert_comment or "",
        calculatedX=float(value.calculated_x) if value.calculated_x is not None else None,
        qualityLevel=value.quality_level,
    )


@router.post("/{period_id}/finalize", response_model=PeriodSummaryOut)
async def finalize_assessment(
    period_id: UUID,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_role("TEST_ANALYST", "QUALITY_MANAGER", "ADMIN")),
) -> PeriodSummaryOut:
    """Завершить оценку: разрешено только при полном заполнении (все подхарактеристики модели).

    Иначе 409 — «оценка не может попасть в оценку», пока заполнены не все характеристики.
    """
    period = await _require_period(db, period_id)
    system = await db.get(System, period.system_id)

    value_rows = (
        await db.execute(
            select(MetricCatalog.characteristic, MetricCatalog.subcharacteristic)
            .join(AssessmentValue, AssessmentValue.metric_id == MetricCatalog.id)
            .where(
                AssessmentValue.period_id == period_id,
                AssessmentValue.calculated_x.isnot(None),
            )
        )
    ).all()
    filled_pairs = {
        (characteristic, subcharacteristic)
        for characteristic, subcharacteristic in value_rows
        if (characteristic, subcharacteristic) in QUALITY_PAIR_KEYS
    }
    filled = len(filled_pairs)
    if filled < TOTAL_SUBS:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Оценка неполная: заполнено {filled} из {TOTAL_SUBS} подхарактеристик. "
                f"Заполните все характеристики, чтобы оценка была учтена."
            ),
        )

    period.status = "COMPLETE"
    await db.commit()
    return PeriodSummaryOut(
        id=period.id,
        system_id=period.system_id,
        system_name=system.name if system else str(period.system_id),
        period=period.period,
        status=period.status,
        filled=filled,
        total=TOTAL_SUBS,
        complete=True,
    )


async def _require_period(db: AsyncSession, period_id: UUID) -> AssessmentPeriod:
    period = await db.get(AssessmentPeriod, period_id)
    if period is None:
        raise HTTPException(status_code=404, detail="Assessment period not found")
    return period
