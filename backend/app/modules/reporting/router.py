"""
REST API домена reporting (ТЗ v13): управленческий дашборд, LLM-аналитика по мерам,
Excel-матрицы периода, статус LLM.

Транзитная зависимость: llm_service ещё в app.services (переезжает задачей #15).
"""
import asyncio
from collections import defaultdict
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.infrastructure.database import get_db
from app.modules.assessment.models import AssessmentPeriod, AssessmentValue
from app.modules.quality import CHARACTERISTICS, canonical_characteristic
from app.modules.reporting.models import DefectMatrix, QualityPlanMatrix, RiskMatrix
from app.modules.reporting.schemas import (
    DashboardDataOut,
    DefectMatrixRow,
    FullExcelMatricesOut,
    ProblematicSystemOut,
    QualityPlanMatrixRow,
    RiskMatrixRow,
)
from app.modules.governance import list_proposals  # кросс-доменный фасад (T-15: метки мер)
from app.modules.llm import reasoning as llm_reasoning
from app.modules.llm import service as llm_service
from app.modules.risk import RiskBase, risks_for_characteristics
from app.modules.systems import System
from app.shared.periods import period_sort_key

router = APIRouter()


@router.get("/llm-status")
async def get_llm_status() -> dict:
    """Статус встроенной LLM — для UI-переключателя «Моки ↔ LLM»."""
    return llm_service.model_info()


class MeasuresAnalyticsItem(BaseModel):
    characteristic: str
    count: int
    systems: int | None = None
    avg_score: float | None = None


class MeasureCardIn(BaseModel):
    """Карточка меры из governance-контура (MeasureDecisionModal) — первичный факт для конвейера."""
    system: str
    characteristic: str
    title: str
    rationale: str | None = None      # обоснование (профсуждение в карточке)
    expectation: str | None = None    # что ожидается от ЛПР
    owner: str | None = None
    due: str | None = None
    score: float | None = None


class MeasuresReasoningIn(BaseModel):
    """Новый формат запроса: агрегаты + сами карточки мер (первичные данные для анализа)."""
    items: list[MeasuresAnalyticsItem] = []
    cards: list[MeasureCardIn] = []


def _measures_blocks(items: list[MeasuresAnalyticsItem], cards: list[MeasureCardIn]) -> str:
    """Блок фактов о мерах: сводка по характеристикам + карточки мер (обоснование/ответственный/срок)."""
    lines = [
        f"{i.characteristic} | мер: {i.count}"
        + (f", ИС: {i.systems}" if i.systems else "")
        + (f", ср.балл: {round(i.avg_score)}%" if i.avg_score is not None else "")
        for i in sorted(items, key=lambda x: x.count, reverse=True)
    ]
    for c in cards[:12]:
        detail = f"{c.system} | {c.characteristic} | {c.title}"
        if c.rationale:
            detail += f": {c.rationale}"
        extras = [x for x in (
            f"балл {round(c.score)}%" if c.score is not None and c.score >= 0 else None,
            f"ответственный {c.owner}" if c.owner else None,
            f"срок {c.due}" if c.due else None,
        ) if x]
        if extras:
            detail += f" ({', '.join(extras)})"
        lines.append(detail)
    return "\n".join(lines)


@router.post("/measures-analytics")
async def measures_analytics(
    payload: MeasuresReasoningIn | list[MeasuresAnalyticsItem],
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Аналитика по МЕРАМ через конвейер многоаспектного аналитического рассуждения (BL-005).

    Принимает новый формат {items, cards} (карточки мер — первичный источник) и легаси-массив
    агрегатов (обратная совместимость). Ответ сохраняет прежние поля (analytics/llm/mapped_risks)
    и дополняется аудируемой трассой (reasoning) и уверенностью (confidence).
    """
    items = payload if isinstance(payload, list) else payload.items
    cards = [] if isinstance(payload, list) else payload.cards
    if not items and not cards:
        return {"analytics": "Активных мер нет — аналитика не сформирована.",
                "llm": llm_service.is_available(), "mapped_risks": [],
                "reasoning": None, "confidence": "низкая"}

    measures_block = _measures_blocks(items, cards)
    chars = sorted({i.characteristic for i in items} | {c.characteristic for c in cards})
    risk_rows = await risks_for_characteristics(db, chars, limit=8)
    risks_block = "\n".join(f"- {r.title}: {r.mitigation or '—'}" for r in risk_rows)

    result = await asyncio.to_thread(
        llm_reasoning.generate_reasoned_conclusion,
        "ИТ-ландшафт банка", "текущий период",
        "",             # профсуждения в этом потоке не передаются (их поток — judgment-conclusion)
        risks_block, "", measures_block, "",
    )
    return {
        "analytics": result["conclusion"],
        "llm": llm_service.is_available(),
        "mapped_risks": [{"title": r.title, "characteristic": r.characteristic} for r in risk_rows],
        "reasoning": result["trace"],
        "confidence": result["confidence"],
    }


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
    all_values = list(result.scalars().all())

    # Сквозная консистентность (DEF-12): управленческий дашборд считает ТОЛЬКО последний период
    # каждой ИС — как /assessments/dashboard. Хронология периодов — по (год, квартал) (DEF-13).
    latest_period_per_system: dict[UUID, UUID] = {}
    for value in sorted(all_values, key=lambda v: period_sort_key(v.period.period), reverse=True):
        latest_period_per_system.setdefault(value.period.system_id, value.period_id)
    values = [v for v in all_values if latest_period_per_system.get(v.period.system_id) == v.period_id]

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

    cells: dict[tuple[str, str], list[float]] = defaultdict(list)
    low_counts: dict[UUID, int] = defaultdict(int)
    systems_by_id: dict[UUID, System] = {}
    present_chars: set[str] = set()
    for value in values:
        systems_by_id[value.period.system.id] = value.period.system
        if value.calculated_x is None:
            continue
        # Нормализация имени характеристики к модели 25010 (DEF-02): теплокарта = 8 характеристик, как в моках.
        canon = canonical_characteristic(value.metric.characteristic)
        if canon is None:
            continue
        score = float(value.calculated_x)
        present_chars.add(canon)
        cells[(value.period.system.name, canon)].append(score)
        if score < 0.41:
            low_counts[value.period.system.id] += 1

    # Канонические характеристики в фиксированном порядке модели (только присутствующие).
    characteristic_names = [c for c in CHARACTERISTICS if c in present_chars]
    system_index = {name: index for index, name in enumerate(system_names)}
    characteristic_index = {name: index for index, name in enumerate(characteristic_names)}

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

    # --- Управленческое резюме: встроенная LLM с обоснованием из базы рисков ---
    char_avg: dict[str, list[float]] = defaultdict(list)
    for (system_name, characteristic), scores in cells.items():
        char_avg[characteristic].append(sum(scores) / len(scores))
    char_pct = {c: round(sum(v) / len(v) * 100) for c, v in char_avg.items() if v}
    metrics_block = "\n".join(
        f"{c} | средняя по ИС | {pct}%" for c, pct in sorted(char_pct.items(), key=lambda kv: kv[1])
    )
    weak_chars = [c for c, pct in sorted(char_pct.items(), key=lambda kv: kv[1])[:2]]

    known_risks = ""
    if weak_chars:
        risk_rows = await risks_for_characteristics(db, weak_chars, limit=5)
        known_risks = "\n".join(
            f"- {r.title}: {r.mitigation or '—'}" for r in risk_rows
        )

    ai_insights = await asyncio.to_thread(
        llm_service.generate_summary,
        "ИТ-ландшафт банка",
        "текущий период",
        metrics_block or f"Средний интегральный показатель — {global_score}%.",
        known_risks,
    )

    return DashboardDataOut(
        globalHealthScore=global_score,
        aiInsights=ai_insights,
        heatmapData=heatmap,
        xAxisLabels=characteristic_names,
        yAxisLabels=system_names,
        problematicSystems=problematic,
    )


class _CamelOut(BaseModel):
    """Базовая Out-схема с camelCase-алиасами (как DashboardDataOut — для консистентности фронта)."""
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class DynamicsPoint(_CamelOut):
    period: str
    integral: float                       # интегральный показатель качества за период, %
    characteristics: dict[str, float]     # характеристика → средний %


class MeasureMarker(_CamelOut):
    """Метка меры на шкале динамики (T-15): когда по характеристике поставлена мера."""
    characteristic: str
    created_at: str
    title: str
    status: str


class SystemDynamicsOut(_CamelOut):
    system_id: UUID
    system_name: str
    points: list[DynamicsPoint]
    measures: list[MeasureMarker]  # метки мер по характеристикам (T-15: наложить на ряд)


@router.get("/system-dynamics", response_model=SystemDynamicsOut)
async def system_dynamics(system_id: UUID, db: AsyncSession = Depends(get_db)) -> SystemDynamicsOut:
    """Динамика качества ИС по периодам (T-15 — эффективность мер + live-режим «Динамики качества»).

    Интегральный показатель и средние по 8 характеристикам (ISO 25010) за каждый квартал в
    хронологии (period_sort_key). Позволяет оценить ЭФФЕКТИВНОСТЬ принятой меры: стало ли лучше по
    её характеристике в периодах после внедрения (мера накладывается на ряд по characteristic+дате).
    """
    system = await db.get(System, system_id)
    if system is None:
        raise HTTPException(status_code=404, detail="Система не найдена")
    result = await db.execute(
        select(AssessmentValue)
        .options(selectinload(AssessmentValue.metric), selectinload(AssessmentValue.period))
        .join(AssessmentPeriod, AssessmentValue.period_id == AssessmentPeriod.id)
        .where(AssessmentPeriod.system_id == system_id)
    )
    by_period: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
    for v in result.scalars().all():
        if v.calculated_x is None:
            continue
        canon = canonical_characteristic(v.metric.characteristic)
        if canon:
            by_period[v.period.period][canon].append(float(v.calculated_x))

    points: list[DynamicsPoint] = []
    for period in sorted(by_period, key=period_sort_key):
        chars = {c: round(sum(s) / len(s) * 100, 1) for c, s in by_period[period].items()}
        integral = round(sum(chars.values()) / len(chars), 1) if chars else 0.0
        points.append(DynamicsPoint(period=period, integral=integral, characteristics=chars))

    # Метки мер (T-15): когда и по какой характеристике поставлена мера — чтобы на фронте
    # наложить на ряд и увидеть, изменилось ли качество по характеристике ПОСЛЕ внедрения.
    proposals = await list_proposals(db, system=system.name)
    measures = [
        MeasureMarker(
            characteristic=canonical_characteristic(p.characteristic) or (p.characteristic or "—"),
            created_at=p.created_at.isoformat() if p.created_at else "",
            title=p.risk_title or p.characteristic or "Мера",
            status=p.status,
        )
        for p in proposals if p.characteristic
    ]
    return SystemDynamicsOut(system_id=system_id, system_name=system.name, points=points, measures=measures)
