"""
Эндпоинты периодов оценки, метрик и дашборда.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from typing import List
from collections import defaultdict

from app.api.deps import get_db
from app.models.assessment import AssessmentPeriod, AssessmentValue
from app.models.metric_catalog import MetricCatalog
from app.models.system import System
from app.schemas.assessment import (
    EditableMetricOut, EditableMetricIn,
    CalculatedMetricOut, ExpertJudgmentCreate,
)

router = APIRouter()

# ─── Dashboard ────────────────────────────────────────────────────────────────

@router.get("/dashboard")
async def get_dashboard(db: AsyncSession = Depends(get_db)):
    """
    Агрегированные данные для главного дашборда.
    Возвращает: globalHealthScore, распределение по уровням,
    данные для heatmap, список проблемных систем.
    """
    # Все активные системы
    systems_result = await db.execute(
        select(System).where(System.is_active == True, System.is_deleted == False)
    )
    systems = systems_result.scalars().all()

    if not systems:
        return _empty_dashboard()

    # Все значения метрик по последним периодам
    values_result = await db.execute(
        select(AssessmentValue, AssessmentPeriod, System, MetricCatalog)
        .join(AssessmentPeriod, AssessmentValue.period_id == AssessmentPeriod.id)
        .join(System, AssessmentPeriod.system_id == System.id)
        .join(MetricCatalog, AssessmentValue.metric_id == MetricCatalog.id)
        .where(
            System.is_active == True,
            System.is_deleted == False,
            AssessmentValue.calculated_x.isnot(None),
        )
        .order_by(AssessmentPeriod.created_at.desc())
    )
    rows = values_result.all()

    if not rows:
        return _empty_dashboard()

    # Подсчёт уровней для Donut
    level_counts: dict[str, int] = defaultdict(int)
    # Данные для heatmap: [xIdx (char), yIdx (system), level_value]
    char_list = [
        "Функциональная пригодность", "Производительность", "Совместимость",
        "Удобство использования", "Надёжность", "Безопасность",
        "Сопровождаемость", "Переносимость", "Качество данных",
    ]
    char_idx = {c: i for i, c in enumerate(char_list)}
    sys_names = [s.name for s in systems]
    sys_idx = {s.id: i for i, s in enumerate(systems)}

    # Агрегация: для heatmap берём средний X по системе+характеристике
    heatmap_agg: dict[tuple, list[float]] = defaultdict(list)
    all_x: list[float] = []

    # Для "проблемных систем" — считаем метрики < 0.41
    low_counts: dict[str, int] = defaultdict(int)
    sys_id_to_name: dict[str, str] = {str(s.id): s.name for s in systems}
    sys_id_to_crit: dict[str, str] = {str(s.id): s.criticality_class for s in systems}

    # Берём только последний период для каждой системы
    latest_period_per_sys: dict[str, str] = {}
    for av, period, system, metric in rows:
        sid = str(system.id)
        if sid not in latest_period_per_sys:
            latest_period_per_sys[sid] = str(period.id)

    for av, period, system, metric in rows:
        sid = str(system.id)
        # Только последний период системы
        if latest_period_per_sys.get(sid) != str(period.id):
            continue

        x = float(av.calculated_x)
        all_x.append(x)
        level_counts[av.quality_level or "Невозможно измерить"] += 1

        ci = char_idx.get(metric.characteristic, -1)
        si = sys_idx.get(system.id, -1)
        if ci >= 0 and si >= 0:
            heatmap_agg[(ci, si)].append(x)

        if x < 0.41:
            low_counts[sid] += 1

    # Глобальный health score
    global_score = round(sum(all_x) / len(all_x), 4) if all_x else 0.0

    # Heatmap data: [xIdx, yIdx, уровень 0-5]
    def x_to_level(x: float) -> int:
        if x >= 0.81: return 5
        if x >= 0.61: return 4
        if x >= 0.41: return 3
        if x >= 0.21: return 2
        if x > 0:    return 1
        return 0

    heatmap_data: list[list[int]] = []
    for (ci, si), xs in heatmap_agg.items():
        avg_x = sum(xs) / len(xs)
        heatmap_data.append([ci, si, x_to_level(avg_x)])

    # Топ-5 проблемных систем
    problematic = sorted(low_counts.items(), key=lambda kv: kv[1], reverse=True)[:5]
    problematic_list = [
        {
            "id": sid,
            "name": sys_id_to_name.get(sid, sid),
            "criticality": sys_id_to_crit.get(sid, ""),
            "lowMetricsCount": cnt,
        }
        for sid, cnt in problematic
    ]

    return {
        "globalHealthScore": global_score,
        "levelCounts": dict(level_counts),
        "heatmapData": heatmap_data,
        "xAxisLabels": char_list,
        "yAxisLabels": sys_names,
        "problematicSystems": problematic_list,
        "totalMetrics": len(all_x),
    }


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


# ─── Метрики периода ──────────────────────────────────────────────────────────

@router.get("/{period_id}/metrics", response_model=List[EditableMetricOut])
async def get_assessment_metrics(
    period_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Получить все метрики периода оценки."""
    result = await db.execute(
        select(AssessmentValue, MetricCatalog)
        .join(MetricCatalog, AssessmentValue.metric_id == MetricCatalog.id)
        .where(AssessmentValue.period_id == period_id)
        .order_by(MetricCatalog.characteristic, MetricCatalog.id)
    )
    rows = result.all()

    return [
        EditableMetricOut(
            id=str(av.id),
            name=f"{mc.characteristic} / {mc.subcharacteristic}",
            description=mc.description or "",
            val_a=float(av.val_a) if av.val_a is not None else None,
            val_b=float(av.val_b) if av.val_b is not None else None,
            expert_comment=av.expert_comment or "",
        )
        for av, mc in rows
    ]


@router.put("/{period_id}/metrics")
async def save_assessment_metrics(
    period_id: str,
    metrics: List[EditableMetricIn],
    db: AsyncSession = Depends(get_db),
):
    """
    Сохранить val_a/val_b для метрик периода.
    Backend пересчитывает X через calculation_engine.
    """
    from app.services.calculation_engine import calculate_metric

    updated = 0
    errors = []

    for m in metrics:
        result = await db.execute(
            select(AssessmentValue, MetricCatalog)
            .join(MetricCatalog, AssessmentValue.metric_id == MetricCatalog.id)
            .where(AssessmentValue.id == m.id)
        )
        row = result.first()
        if not row:
            errors.append(f"Метрика id={m.id} не найдена")
            continue

        av, mc = row
        av.val_a = m.val_a
        av.val_b = m.val_b
        av.expert_comment = m.expert_comment

        # Пересчёт X
        if m.val_a is not None and m.val_b is not None:
            x, level = calculate_metric(m.val_a, m.val_b, mc.formula_type)
            av.calculated_x = x
            av.quality_level = level

        updated += 1

    await db.commit()
    return {"status": "ok", "updated": updated, "errors": errors}


@router.get("/{period_id}/calculated", response_model=List[CalculatedMetricOut])
async def get_calculated_metrics(
    period_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Получить рассчитанные значения метрик периода."""
    result = await db.execute(
        select(AssessmentValue, MetricCatalog)
        .join(MetricCatalog, AssessmentValue.metric_id == MetricCatalog.id)
        .where(
            AssessmentValue.period_id == period_id,
            AssessmentValue.calculated_x.isnot(None),
        )
    )
    rows = result.all()

    return [
        CalculatedMetricOut(
            id=str(av.id),
            name=f"{mc.characteristic} / {mc.subcharacteristic}",
            calculatedX=float(av.calculated_x),
            systemLevel=av.quality_level or "Невозможно измерить",
            expertComment=av.expert_comment,
        )
        for av, mc in rows
    ]