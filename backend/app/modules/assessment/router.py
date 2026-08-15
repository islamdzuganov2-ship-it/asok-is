"""
REST API домена assessment (ТЗ v13): дашборд оценки, периоды, значения метрик,
профессиональные суждения и LLM-заключение по ним.

Транзитные зависимости на пути strangler-миграции: llm_service и excel_importer
ещё живут в app.services (переезжают задачами #15/#14) — импортируются по старым путям.
"""
import asyncio
from collections import defaultdict
from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.database import get_db
from app.modules.iam import get_current_user, require_permission
from app.modules.quality import (
    ABBR,
    CHARACTERISTICS,
    QUALITY_MODEL,
    QUALITY_PAIR_KEYS,
    TOTAL_SUBS,
    FormulaType,
    MetricCatalog,
    calculate_metric,
    canonical_characteristic,
    map_to_level,
)
from app.modules.assessment.models import AssessmentPeriod, AssessmentValue, ProfessionalJudgment
from app.modules.assessment.schemas import (
    CalculatedMetricOut,
    EditableMetricIn,
    EditableMetricOut,
    JudgmentIn,
    JudgmentOut,
    JudgmentsStatusOut,
    PendingJudgmentOut,
    PeriodCreate,
    PeriodOut,
    PeriodSummaryOut,
    ValueAddIn,
)
from app.modules.risk import RiskBase
from app.modules.systems import System
from app.shared.periods import (
    PERIOD_LOCKED_MESSAGE,
    STATUS_CALCULATED,
    STATUS_COMPLETE,
    STATUS_DRAFT,
    is_period_locked,
    period_sort_key,
)
from app.modules.dataio.importer import ensure_period_values, get_or_create_metric
from app.modules.llm import gate as llm_gate
from app.modules.llm import personas as llm_personas
from app.modules.llm import reasoning as llm_reasoning
from app.modules.llm import service as llm_service

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
async def get_dashboard(db: AsyncSession = Depends(get_db),
                        _: dict = Depends(get_current_user)):
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

    # Последний период по каждой ИС — хронологически по (год, квартал), а не по created_at
    # (сиды пишут периоды одной транзакцией) и не по строке («Q4-2025» > «Q2-2026») — DEF-13.
    rows = sorted(rows, key=lambda r: period_sort_key(r[1].period), reverse=True)
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
async def create_assessment_period(
    payload: PeriodCreate,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("assessment.edit")),
) -> AssessmentPeriod:
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

    period = AssessmentPeriod(system_id=payload.system_id, period=payload.period, status=STATUS_DRAFT)
    db.add(period)
    await db.flush()
    await ensure_period_values(db, period)
    await db.commit()
    await db.refresh(period)
    return period


@router.get("/periods", response_model=list[PeriodOut])
async def list_assessment_periods(
    system_id: UUID | None = None,
    limit: int = Query(500, ge=1, le=5000),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(get_current_user),
) -> list[AssessmentPeriod]:
    stmt = select(AssessmentPeriod).join(System).where(System.is_deleted.is_(False)).order_by(
        AssessmentPeriod.created_at.desc()
    )
    if system_id is not None:
        stmt = stmt.where(AssessmentPeriod.system_id == system_id)
    # ДЕФ-24: потолок выборки. На демо-объёме (4 ИС) не заметен, но заказчик ориентируется
    # на 100+ систем (БТ-264) — без LIMIT ответ и память росли бы линейно.
    result = await db.execute(stmt.limit(limit))
    return list(result.scalars().all())


@router.get("/periods/summary", response_model=list[PeriodSummaryOut])
async def list_period_summaries(
    system_id: UUID | None = None,
    limit: int = Query(500, ge=1, le=5000),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(get_current_user),
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
    rows = (await db.execute(stmt.limit(limit))).all()  # ДЕФ-24: потолок выборки
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
async def get_assessment_metrics(period_id: UUID, db: AsyncSession = Depends(get_db),
                                 _: dict = Depends(get_current_user)):
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
    _: dict = Depends(require_permission("assessment.edit")),
):
    # T-47: завершённая оценка заблокирована — правка только после «открытия на корректировку»
    # (POST /{period_id}/reopen), иначе итоги дашбордов молча менялись бы задним числом.
    _ensure_editable(await _require_period(db, period_id))
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
        period.status = STATUS_CALCULATED if updated else period.status
    await db.commit()
    return {"status": "ok", "updated": updated, "errors": errors}


@router.get("/{period_id}/calculated", response_model=List[CalculatedMetricOut])
async def get_calculated_metrics(period_id: UUID, db: AsyncSession = Depends(get_db),
                                 _: dict = Depends(get_current_user)):
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
    _: dict = Depends(require_permission("assessment.edit")),
) -> EditableMetricOut:
    """Добавить/заполнить оценку для пары (характеристика, подхарактеристика) в периоде.

    Метрика каталога находится или создаётся по паре; значение для (период, метрика)
    находится или создаётся; X и уровень пересчитываются. Поддерживает бэкофилл пропущенных строк.
    """
    # Завершённую оценку сначала открывают на корректировку (T-47) — см. _ensure_editable.
    _ensure_editable(await _require_period(db, period_id))
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
    _artifact = (payload.artifact_links or "").strip()
    value.artifact_links = [_artifact] if _artifact else None
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
    _: dict = Depends(require_permission("assessment.edit")),
) -> PeriodSummaryOut:
    """Завершить оценку: разрешено только при полном заполнении (все подхарактеристики модели).

    Иначе 409 — «оценка не может попасть в оценку», пока заполнены не все характеристики.
    """
    period = await _require_period(db, period_id)
    system = await db.get(System, period.system_id)

    filled = len(await _filled_pairs(db, period_id))
    if filled < TOTAL_SUBS:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Оценка неполная: заполнено {filled} из {TOTAL_SUBS} подхарактеристик. "
                f"Заполните все характеристики, чтобы оценка была учтена."
            ),
        )

    # T-55: метрика «Невозможно измерить» обязана иметь ПРИЧИНУ (expert_comment). Профессиональное
    # суждение и меры по таким метрикам ведутся в соответствующих разделах; здесь жёстко гарантируем
    # причину — без неё завершить оценку нельзя.
    unmeasured = (
        await db.execute(
            select(MetricCatalog.subcharacteristic, AssessmentValue.expert_comment)
            .join(AssessmentValue, AssessmentValue.metric_id == MetricCatalog.id)
            .where(
                AssessmentValue.period_id == period_id,
                AssessmentValue.unmeasurable.is_(True),
            )
        )
    ).all()
    missing_reason = sorted({sub for sub, comment in unmeasured if not (comment or "").strip()})
    if missing_reason:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Неизмеримые метрики без причины: " + ", ".join(missing_reason)
                + ". Для метрики «Невозможно измерить» обязательна причина (комментарий эксперта)."
            ),
        )

    period.status = STATUS_COMPLETE
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


@router.post("/{period_id}/reopen", response_model=PeriodSummaryOut)
async def reopen_assessment(
    period_id: UUID,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("assessment.edit")),
) -> PeriodSummaryOut:
    """T-47: открыть ЗАВЕРШЁННУЮ оценку на корректировку (разблокировка периода).

    Завершённый период (COMPLETE) закрыт на правку значений — иначе цифры дашбордов менялись
    бы задним числом без явного действия. Разблокировка возвращает период в CALCULATED: значения
    правятся обычными эндпоинтами, после чего оценку завершают заново (POST /finalize).
    Если период не завершён — 409 (правка и так доступна).
    """
    period = await _require_period(db, period_id)
    system = await db.get(System, period.system_id)
    if period.status != STATUS_COMPLETE:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Оценка не завершена — корректировка доступна без разблокировки.",
        )

    period.status = STATUS_CALCULATED
    await db.commit()
    filled = len(await _filled_pairs(db, period_id))
    return PeriodSummaryOut(
        id=period.id,
        system_id=period.system_id,
        system_name=system.name if system else str(period.system_id),
        period=period.period,
        status=period.status,
        filled=filled,
        total=TOTAL_SUBS,
        complete=filled >= TOTAL_SUBS,
    )


@router.get("/{period_id}/judgments", response_model=JudgmentsStatusOut)
async def get_judgments(period_id: UUID, db: AsyncSession = Depends(get_db),
                        _: dict = Depends(get_current_user)) -> JudgmentsStatusOut:
    """Профессиональные суждения периода + полнота (обязательны по всем 31 подхарактеристике)."""
    await _require_period(db, period_id)
    rows = list((await db.execute(
        select(ProfessionalJudgment).where(ProfessionalJudgment.period_id == period_id)
    )).scalars().all())
    filled = len({
        (j.characteristic, j.subcharacteristic) for j in rows
        if (j.characteristic, j.subcharacteristic) in QUALITY_PAIR_KEYS
    })
    return JudgmentsStatusOut(
        period_id=str(period_id),
        filled=filled,
        total=TOTAL_SUBS,
        complete=filled >= TOTAL_SUBS,
        items=[
            JudgmentOut(
                id=str(j.id), characteristic=j.characteristic,
                subcharacteristic=j.subcharacteristic, judgment_text=j.judgment_text, author=j.author,
            )
            for j in rows
        ],
    )


@router.put("/{period_id}/judgments", response_model=JudgmentsStatusOut)
async def save_judgments(
    period_id: UUID,
    payload: List[JudgmentIn],
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_permission("assessment.review")),
) -> JudgmentsStatusOut:
    """Внести/обновить профессиональные суждения (задача менеджера по качеству). Upsert по паре."""
    await _require_period(db, period_id)
    author = user.get("username")
    for item in payload:
        char = item.characteristic.strip()
        sub = item.subcharacteristic.strip()
        text = item.judgment_text.strip()
        if not text:
            continue
        existing = (await db.execute(
            select(ProfessionalJudgment).where(
                ProfessionalJudgment.period_id == period_id,
                ProfessionalJudgment.characteristic == char,
                ProfessionalJudgment.subcharacteristic == sub,
            )
        )).scalar_one_or_none()
        if existing is not None:
            existing.judgment_text = text
            existing.author = author
        else:
            db.add(ProfessionalJudgment(
                period_id=period_id, characteristic=char, subcharacteristic=sub,
                judgment_text=text, author=author,
            ))
    await db.commit()
    return await get_judgments(period_id, db)


async def _gate_context(db: AsyncSession, period: AssessmentPeriod) -> tuple:
    """Прогоняет детерминированный движок правил (gate) на ПОСЧИТАННЫХ метриках периода.

    Возвращает (GateResult, измерено подхарактеристик, всего подхарактеристик). Текст
    сработавших правил — повод для объяснения LLM; сама серьёзность и счётчики покрытия
    нужны матрицам решений (modules/llm/decisions.py). Вердикт Severity/Coverage/Regression
    выносит Python-движок, а не модель (см. modules/llm/gate.py).
    """
    rows = (await db.execute(
        select(AssessmentValue.calculated_x).where(AssessmentValue.period_id == period.id)
    )).scalars().all()
    total = len(rows)
    measured = [float(v) for v in rows if v is not None]
    q = (sum(measured) / len(measured)) if measured else None

    # Regression: сравнение с интегральным качеством НЕПОСРЕДСТВЕННО предыдущего периода ИС.
    delta_pp = None
    if q is not None:
        periods = (await db.execute(
            select(AssessmentPeriod).where(AssessmentPeriod.system_id == period.system_id)
        )).scalars().all()
        ordered = sorted(periods, key=lambda p: period_sort_key(p.period))
        idx = next((i for i, p in enumerate(ordered) if p.id == period.id), None)
        if idx is not None and idx > 0:
            prev_vals = (await db.execute(
                select(AssessmentValue.calculated_x).where(
                    AssessmentValue.period_id == ordered[idx - 1].id,
                    AssessmentValue.calculated_x.isnot(None),
                )
            )).scalars().all()
            if prev_vals:
                prev_q = sum(float(x) for x in prev_vals) / len(prev_vals)
                delta_pp = (q - prev_q) * 100.0

    result = llm_gate.evaluate_gate(
        q=q, measured_subs=len(measured), total_subs=total, delta_pp=delta_pp,
    )
    return result, len(measured), total


@router.get("/{period_id}/judgment-conclusion")
async def get_judgment_conclusion(period_id: UUID, db: AsyncSession = Depends(get_db),
                                  current_user: dict = Depends(get_current_user)) -> dict:
    """Заключение по профсуждениям через КОНВЕЙЕР многоаспектного рассуждения (BL-005).

    ISO 25010/38500: факты входа → проблема → первопричина → уточняющие вопросы → ролевые
    точки зрения → контроль достоверности (grounding) → синтез мер → саморефлексия →
    заключение ЛПР. В ответе — аудируемая трасса (`reasoning`). Самообучение: суждения
    прошлых периодов передаются как история (RAG).

    ТЗ v18: заключение формируется ПОД РОЛЬ запросившего (persona) — топ-менеджеру короткий
    вывод с решением, менеджеру качества разбор по характеристикам, риск-менеджеру риск-сценарий.
    Данные при этом одни и те же: меняется адресация вывода, а не состав фактов.
    """
    period = await _require_period(db, period_id)
    system = await db.get(System, period.system_id)
    system_name = system.name if system else str(period.system_id)

    rows = list((await db.execute(
        select(ProfessionalJudgment).where(ProfessionalJudgment.period_id == period_id)
        .order_by(ProfessionalJudgment.characteristic)
    )).scalars().all())
    judgments_block = "\n".join(
        f"{j.characteristic} / {j.subcharacteristic}: {j.judgment_text}" for j in rows
    )

    # Маппинг на базу рисков: активные риски по характеристикам, встречающимся в суждениях.
    chars = sorted({j.characteristic for j in rows})
    risk_rows = []
    if chars:
        risk_rows = list((await db.execute(
            select(RiskBase)
            .where(RiskBase.status == "active")
            .where(RiskBase.characteristic.in_(chars))
            .limit(8)
        )).scalars().all())
    risks_block = "\n".join(f"- {r.title}: {r.mitigation or '—'}" for r in risk_rows)

    # Факты входа: расчётные метрики периода — ещё один первичный источник фактов.
    metric_rows = (await db.execute(
        select(MetricCatalog.characteristic, MetricCatalog.subcharacteristic, AssessmentValue.calculated_x)
        .join(AssessmentValue, AssessmentValue.metric_id == MetricCatalog.id)
        .where(AssessmentValue.period_id == period_id, AssessmentValue.calculated_x.isnot(None))
        .order_by(AssessmentValue.calculated_x)
        .limit(15)
    )).all()
    metrics_block = "\n".join(
        f"{c} | {s} | {round(float(x) * 100)}%" for c, s, x in metric_rows
    )

    # Преемственность/самообучение: суждения прошлых периодов той же ИС.
    history_block = ""
    if system is not None:
        past = list((await db.execute(
            select(ProfessionalJudgment.characteristic, ProfessionalJudgment.subcharacteristic,
                   ProfessionalJudgment.judgment_text, AssessmentPeriod.period)
            .join(AssessmentPeriod, ProfessionalJudgment.period_id == AssessmentPeriod.id)
            .where(AssessmentPeriod.system_id == system.id, ProfessionalJudgment.period_id != period_id)
            .limit(10)
        )).all())
        history_block = "\n".join(
            f"[{p}] {c} / {s}: {t}" for c, s, t, p in past
        )

    # Rule Engine (детерминированный): решает, ЧТО объяснять; вердикт выносит Python, не LLM.
    gate_result, measured_subs, total_subs = await _gate_context(db, period)
    rules_block = gate_result.as_block()
    criticality = ""
    if system is not None and system.criticality_class is not None:
        criticality = getattr(system.criticality_class, "value", str(system.criticality_class))

    # Персона адресата — из роли запросившего (RBAC → персона, см. modules/llm/personas.py).
    roles = current_user.get("roles") or []
    persona = llm_personas.resolve(roles[0] if roles else "")

    result = await asyncio.to_thread(
        llm_reasoning.generate_reasoned_conclusion,
        system_name, period.period, judgments_block, risks_block, history_block,
        "",  # карточки мер живут во фронтовом контуре governance — честно «данные отсутствуют»
        metrics_block, rules_block,
        gate_result.severity, criticality, measured_subs, total_subs, persona.code,
    )
    return {
        "period_id": str(period_id),
        "system_name": system_name,
        "judgments_count": len(rows),
        "conclusion": result["conclusion"],
        "reasoning": result["trace"],
        "confidence": result["confidence"],
        "fingerprint": result["fingerprint"],
        "persona": {"code": persona.code, "title": persona.title, "audience": persona.audience},
        "decisions": result["decisions"],
        "fired_rules": [ln.lstrip("- ") for ln in rules_block.splitlines() if ln.strip()],
        "mapped_risks": [
            {"title": r.title, "characteristic": r.characteristic, "mitigation": r.mitigation}
            for r in risk_rows
        ],
        "llm": llm_service.is_available(),
    }


@router.get("/judgments-status")
async def judgments_status(db: AsyncSession = Depends(get_db),
                           _: dict = Depends(get_current_user)) -> list[dict]:
    """Периоды с активной оценкой, где проф. суждения заполнены НЕ полностью.

    Для уведомлений менеджера по качеству: на каких системах есть пустые проф. суждения.
    """
    period_rows = (await db.execute(
        select(AssessmentPeriod, System)
        .join(System, AssessmentPeriod.system_id == System.id)
        .where(System.is_deleted.is_(False))
    )).all()
    if not period_rows:
        return []
    # Периоды, где реально идёт оценка (есть измеренные/«невозможно измерить» значения).
    active = set((await db.execute(
        select(AssessmentValue.period_id)
        .where(or_(AssessmentValue.calculated_x.isnot(None), AssessmentValue.unmeasurable.is_(True)))
        .distinct()
    )).scalars().all())
    judg = (await db.execute(
        select(ProfessionalJudgment.period_id, ProfessionalJudgment.characteristic, ProfessionalJudgment.subcharacteristic)
    )).all()
    filled: dict = defaultdict(set)
    for pid, c, s in judg:
        if (c, s) in QUALITY_PAIR_KEYS:
            filled[pid].add((c, s))
    # Только ПОСЛЕДНИЙ активный период каждой ИС: исторические кварталы суждениями не дозаполняют,
    # уведомления МК не должны шуметь по архиву (DEF-14).
    latest: dict[str, AssessmentPeriod] = {}
    latest_system: dict[str, System] = {}
    for period, system in period_rows:
        if period.id not in active:
            continue
        key = str(system.id)
        if key not in latest or period_sort_key(period.period) > period_sort_key(latest[key].period):
            latest[key] = period
            latest_system[key] = system
    out = []
    for key, period in latest.items():
        system = latest_system[key]
        n = len(filled.get(period.id, set()))
        if n >= TOTAL_SUBS:
            continue
        out.append({
            "period_id": str(period.id), "system_name": system.name,
            "period": period.period, "filled": n, "total": TOTAL_SUBS,
        })
    out.sort(key=lambda x: x["filled"], reverse=True)
    return out[:30]


@router.get("/judgments-pending", response_model=list[PendingJudgmentOut])
async def judgments_pending(
    system: str | None = None,
    period_id: UUID | None = None,
    all_periods: bool = False,
    limit: int = 1000,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(get_current_user),
) -> list[PendingJudgmentOut]:
    """T-48: метрики оценки, по которым НЕ внесено профессиональное суждение.

    Строка = пара (характеристика, подхарактеристика) модели, у которой в периоде ЕСТЬ значение
    (рассчитан X либо «невозможно измерить»), но НЕТ записи в professional_judgments. После
    внесения суждения (PUT /{period_id}/judgments) строка уходит из выдачи.

    По умолчанию — только ПОСЛЕДНИЙ период с оценкой по каждой ИС (DEF-14: архивные кварталы
    суждениями не дозаполняют). `all_periods=true` снимает ограничение, `period_id` — точечный
    выбор периода. Порядок: худший балл первым («невозможно измерить» = -1 — в начале), чтобы
    менеджер по качеству начинал с проблемных зон.
    """
    period_rows = (await db.execute(
        select(AssessmentPeriod, System)
        .join(System, AssessmentPeriod.system_id == System.id)
        .where(System.is_deleted.is_(False))
    )).all()
    if system:
        period_rows = [(p, s) for p, s in period_rows if s.name == system]
    if period_id is not None:
        period_rows = [(p, s) for p, s in period_rows if p.id == period_id]
    if not period_rows:
        return []

    value_rows = (await db.execute(
        select(
            AssessmentValue.period_id,
            MetricCatalog.characteristic,
            MetricCatalog.subcharacteristic,
            AssessmentValue.calculated_x,
            AssessmentValue.quality_level,
            AssessmentValue.expert_comment,
        )
        .join(MetricCatalog, AssessmentValue.metric_id == MetricCatalog.id)
        .where(
            AssessmentValue.period_id.in_([p.id for p, _ in period_rows]),
            or_(AssessmentValue.calculated_x.isnot(None), AssessmentValue.unmeasurable.is_(True)),
        )
    )).all()
    if not value_rows:
        return []
    active = {row[0] for row in value_rows}

    scope = [(p, s) for p, s in period_rows if p.id in active]
    if period_id is None and not all_periods:
        latest: dict[str, tuple[AssessmentPeriod, System]] = {}
        for period, sys_row in scope:
            key = str(sys_row.id)
            if key not in latest or period_sort_key(period.period) > period_sort_key(latest[key][0].period):
                latest[key] = (period, sys_row)
        scope = list(latest.values())
    scope_by_id = {p.id: (p, s) for p, s in scope}
    if not scope_by_id:
        return []

    judged = {
        (pid, char, sub)
        for pid, char, sub in (await db.execute(
            select(
                ProfessionalJudgment.period_id,
                ProfessionalJudgment.characteristic,
                ProfessionalJudgment.subcharacteristic,
            ).where(ProfessionalJudgment.period_id.in_(list(scope_by_id.keys())))
        )).all()
    }

    out: list[PendingJudgmentOut] = []
    for pid, char, sub, calculated_x, quality_level, comment in value_rows:
        if pid not in scope_by_id or (char, sub) not in QUALITY_PAIR_KEYS:
            continue
        if (pid, char, sub) in judged:
            continue
        period, sys_row = scope_by_id[pid]
        out.append(PendingJudgmentOut(
            period_id=str(pid),
            system_id=str(sys_row.id),
            system_name=sys_row.name,
            period=period.period,
            characteristic=char,
            subcharacteristic=sub,
            score_pct=round(float(calculated_x) * 100) if calculated_x is not None else -1,
            quality_level=quality_level,
            expert_comment=comment,
        ))

    out.sort(key=lambda r: (r.score_pct, r.system_name, r.characteristic, r.subcharacteristic))
    return out[: max(1, limit)]


@router.get("/judgments-filled")
async def judgments_filled(
    system_name: str | None = None,
    limit: int = Query(1000, ge=1, le=10000),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(get_current_user),
) -> list[dict]:
    """Заполненные профессиональные суждения (со связкой характеристика + система + период).

    Для карточки на дашборде менеджера по качеству. Можно отфильтровать по имени ИС.
    """
    stmt = (
        select(ProfessionalJudgment, AssessmentPeriod, System)
        .join(AssessmentPeriod, ProfessionalJudgment.period_id == AssessmentPeriod.id)
        .join(System, AssessmentPeriod.system_id == System.id)
        .where(System.is_deleted.is_(False))
        .order_by(System.name, ProfessionalJudgment.characteristic)
    )
    if system_name:
        stmt = stmt.where(System.name == system_name)
    rows = (await db.execute(stmt.limit(limit))).all()  # ДЕФ-24: потолок выборки
    return [
        {
            "system_name": s.name, "period": p.period,
            "characteristic": j.characteristic, "subcharacteristic": j.subcharacteristic,
            "judgment_text": j.judgment_text,
        }
        for j, p, s in rows
    ]


async def _require_period(db: AsyncSession, period_id: UUID) -> AssessmentPeriod:
    period = await db.get(AssessmentPeriod, period_id)
    if period is None:
        raise HTTPException(status_code=404, detail="Assessment period not found")
    return period


async def _filled_pairs(db: AsyncSession, period_id: UUID) -> set[tuple[str, str]]:
    """Пары модели (характеристика, подхарактеристика) периода с заполненной оценкой.

    Заполнена = рассчитан X либо отмечено «невозможно измерить». Легаси-метрики каталога вне
    эталонной модели в полноту не идут (как в /periods/summary).
    """
    rows = (
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
    return {(char, sub) for char, sub in rows if (char, sub) in QUALITY_PAIR_KEYS}


def _ensure_editable(period: AssessmentPeriod) -> AssessmentPeriod:
    """T-47: завершённая оценка заблокирована на правку — сначала разблокировка (/reopen)."""
    if is_period_locked(period.status):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=PERIOD_LOCKED_MESSAGE)
    return period
