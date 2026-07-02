from collections import defaultdict
from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db, require_role
from app.constants.quality_model import (
    ABBR,
    CHARACTERISTICS,
    QUALITY_MODEL,
    QUALITY_PAIR_KEYS,
    TOTAL_SUBS,
    canonical_characteristic,
)
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
        "characteristics": [],
        "systemDetails": [],
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


def _level_bucket_pct(pct: float) -> int:
    """Бакет уровня по проценту (0..100); pct<0 → 0 («невозможно измерить»/нет данных)."""
    if pct < 0:
        return 0
    if pct < 21:
        return 1
    if pct < 41:
        return 2
    if pct < 61:
        return 3
    if pct < 81:
        return 4
    return 5


def _avg_measured(vals: list[float]) -> float:
    """Среднее по измеримым (>=0) значениям в процентах; -1, если измеримых нет."""
    meas = [v for v in vals if v >= 0]
    return round(sum(meas) / len(meas)) if meas else -1.0


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
            or_(AssessmentValue.calculated_x.isnot(None), AssessmentValue.unmeasurable.is_(True)),
        )
        .order_by(AssessmentPeriod.created_at.desc(), AssessmentPeriod.period.desc())
    )
    rows = values_result.all()
    if not rows:
        return _empty_dashboard()

    # Последний период по каждой ИС.
    latest_period_per_system: dict[str, str] = {}
    for _, period, system, _ in rows:
        latest_period_per_system.setdefault(str(system.id), str(period.id))
    latest_rows = [
        (value, system, metric)
        for value, period, system, metric in rows
        if latest_period_per_system.get(str(system.id)) == str(period.id)
    ]

    # Дерево: ИС → каноническая характеристика → {подхарактеристика: балл%} (-1 = невозможно измерить).
    # Имена характеристик нормализуются к модели 25010 (DEF-02): дашборд = 8 характеристик, как в моках.
    tree: dict[str, dict[str, dict[str, float]]] = defaultdict(lambda: defaultdict(dict))
    crit_by_name: dict[str, str] = {}
    level_counts: dict[str, int] = defaultdict(int)
    measured_x: list[float] = []
    for value, system, metric in latest_rows:
        canon = canonical_characteristic(metric.characteristic)
        if canon is None:
            continue  # имя вне канонической модели — не показываем (защита от мусора)
        crit_by_name[system.name] = (
            system.criticality_class.value if hasattr(system.criticality_class, "value")
            else str(system.criticality_class)
        )
        if value.unmeasurable or value.calculated_x is None:
            tree[system.name][canon][metric.subcharacteristic] = -1.0
            level_counts["Невозможно измерить"] += 1
        else:
            x = float(value.calculated_x)
            measured_x.append(x)
            tree[system.name][canon][metric.subcharacteristic] = round(x * 100)
            level_counts[value.quality_level or map_to_level(x)] += 1

    if not tree:
        return _empty_dashboard()

    # Метаданные по каждой ИС: баллы характеристик, итоговый балл, число «низких» метрик.
    sys_meta: dict[str, dict] = {}
    for name, chars in tree.items():
        char_scores = {c: _avg_measured(list(subs.values())) for c, subs in chars.items()}
        meas_chars = [s for s in char_scores.values() if s >= 0]
        sys_meta[name] = {
            "char_scores": char_scores,
            "score": round(sum(meas_chars) / len(meas_chars)) if meas_chars else 0,
            "low": sum(1 for subs in chars.values() for v in subs.values() if 0 <= v < 41),
        }

    # Порядок ИС: больше «низких» метрик → выше; затем по итоговому баллу (как ANALYTICS_ORDER в моках).
    ordered = sorted(sys_meta.keys(), key=lambda n: (-sys_meta[n]["low"], sys_meta[n]["score"]))
    sys_index = {name: i for i, name in enumerate(ordered)}
    char_index = {c: i for i, c in enumerate(CHARACTERISTICS)}

    # systemDetails: по каждой ИС — характеристики и подхарактеристики в каноническом порядке.
    system_details = [
        {
            "name": name,
            "chars": [
                {
                    "title": char_title,
                    "abbr": ABBR.get(char_title, char_title),
                    "score": sys_meta[name]["char_scores"].get(char_title, -1),
                    "subs": [
                        {"name": sub, "score": tree[name].get(char_title, {}).get(sub, -1)}
                        for sub, _ in subs_def
                    ],
                }
                for char_title, subs_def in QUALITY_MODEL
            ],
        }
        for name in ordered
    ]

    # characteristics: средние по характеристикам/подхарактеристикам across ИС (шапка теплокарты).
    characteristics_out = [
        {
            "title": char_title,
            "abbr": ABBR.get(char_title, char_title),
            "score": _avg_measured([sys_meta[n]["char_scores"].get(char_title, -1) for n in ordered]),
            "subs": [
                {"name": sub, "score": _avg_measured([tree[n].get(char_title, {}).get(sub, -1) for n in ordered])}
                for sub, _ in subs_def
            ],
        }
        for char_title, subs_def in QUALITY_MODEL
    ]

    heatmap_data = [
        [char_index[char_title], sys_index[name], _level_bucket_pct(sys_meta[name]["char_scores"].get(char_title, -1))]
        for name in ordered
        for char_title, _ in QUALITY_MODEL
    ]

    problematic = [
        {
            "id": name,
            "name": name,
            "criticality": crit_by_name.get(name, "BUSINESS OPERATIONAL"),
            "lowMetricsCount": sys_meta[name]["low"],
        }
        for name in ordered
        if sys_meta[name]["low"] > 0
    ][:10]

    total_metrics = sum(len(subs) for chars in tree.values() for subs in chars.values())

    return {
        "globalHealthScore": round(sum(measured_x) / len(measured_x), 4) if measured_x else 0.0,
        "levelCounts": dict(level_counts),
        "heatmapData": heatmap_data,
        "xAxisLabels": list(CHARACTERISTICS),
        "yAxisLabels": ordered,
        "problematicSystems": problematic,
        "totalMetrics": total_metrics,
        "characteristics": characteristics_out,
        "systemDetails": system_details,
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
                or_(
                    AssessmentValue.calculated_x.isnot(None),
                    AssessmentValue.unmeasurable.is_(True),
                ),
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
            unmeasurable=bool(value.unmeasurable),
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
        value.expert_comment = item.expert_comment
        value.unmeasurable = bool(item.unmeasurable)
        if value.unmeasurable:
            # «Невозможно измерить»: комментарий с причиной обязателен.
            if not (item.expert_comment or "").strip():
                errors.append(
                    f"Metric value id={item.id}: для «Невозможно измерить» обязателен комментарий (причина)"
                )
                continue
            value.val_a = None
            value.val_b = None
            value.calculated_x = None
            value.quality_level = "Невозможно измерить"
        elif item.val_a is not None and item.val_b is not None:
            value.val_a = item.val_a
            value.val_b = item.val_b
            formula_type = metric.formula_type.value if hasattr(metric.formula_type, "value") else str(metric.formula_type)
            x = calculate_metric(item.val_a, item.val_b, formula_type)
            value.calculated_x = x
            value.quality_level = map_to_level(x)
        else:
            value.val_a = item.val_a
            value.val_b = item.val_b
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

    value.expert_comment = (payload.expert_comment or "").strip() or None
    value.unmeasurable = bool(payload.unmeasurable)
    if value.unmeasurable:
        # «Невозможно измерить» (нет возможности собрать данные) → комментарий обязателен.
        if not value.expert_comment:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Для «Невозможно измерить» обязателен комментарий с причиной",
            )
        value.val_a = None
        value.val_b = None
        value.calculated_x = None
        value.quality_level = "Невозможно измерить"
    elif payload.val_a is not None and payload.val_b is not None:
        value.val_a = payload.val_a
        value.val_b = payload.val_b
        formula_type = metric.formula_type.value if hasattr(metric.formula_type, "value") else str(metric.formula_type)
        x = calculate_metric(float(payload.val_a), float(payload.val_b), formula_type)
        value.calculated_x = x
        value.quality_level = map_to_level(x)
    else:
        value.val_a = payload.val_a
        value.val_b = payload.val_b
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
        unmeasurable=bool(value.unmeasurable),
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
                or_(
                    AssessmentValue.calculated_x.isnot(None),
                    AssessmentValue.unmeasurable.is_(True),
                ),
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
