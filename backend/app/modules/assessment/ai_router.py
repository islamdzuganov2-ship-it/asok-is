"""REST API контура оценки СИИ по ГОСТ Р 59898-2021 (BL-001 E1/E2) — /api/v1/ai-assessments.

По образцу ISO-роутера домена assessment. Периоды переиспользуются (AssessmentPeriod),
значения — в отдельной таблице ai_assessment_values (не смешиваются с ISO-дашбордами).

⚠️ СТАТУС «ПОД РАЗВИТИЕ» (2026-07-06): роутер смонтирован и рабочий, но раздел СИИ скрыт из UI
(фронт-пункт меню не выведен). Оставлен закоммиченным до потребности открыть; этап E3 (тестовые
датасеты/выбросы, паритет сред, конкордация Кендалла, сравнение СИИ, справочник qm_node в БД)
отложен — см. docs/CODE_REVIEW_2026-07-06.md, T-17.
"""
from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.database import get_db
from app.modules.iam import require_role
from app.modules.quality import (
    AI_SUB_INDEX,
    AI_TOTAL_SUBS,
    METRIC_KINDS,
    ai_aggregate,
    ai_compute_metric,
    ai_model_tree,
    ai_normalize_to_baseline,
)
from app.modules.assessment.models import AiAssessmentValue, AiWeight, AssessmentPeriod
from app.modules.assessment.ai_schemas import (
    AiCalculationOut,
    AiConformanceReport,
    AiConformanceRow,
    AiPeriodCreate,
    AiValueIn,
    AiValueOut,
)
from app.modules.systems.models import System

router = APIRouter()

_EDIT_ROLES = ("TEST_ANALYST", "QUALITY_MANAGER", "ADMIN")


@router.get("/ai-model")
async def get_ai_model() -> dict:
    """Дерево модели 59898: 4 группы → 8 характеристик → 37 субхарактеристик (7 ИИ-специфичных)."""
    return {"model_kind": "GOST59898", "total_subs": AI_TOTAL_SUBS, "groups": ai_model_tree()}


@router.post("/periods", status_code=status.HTTP_201_CREATED)
async def create_ai_period(payload: AiPeriodCreate, db: AsyncSession = Depends(get_db)) -> dict:
    system = await db.get(System, payload.system_id)
    if system is None or system.is_deleted:
        raise HTTPException(status_code=404, detail="System not found")
    if (system.system_kind or "CLASSIC") != "AI":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Система не помечена как СИИ (system_kind=AI) — контур 59898 недоступен",
        )
    existing = (await db.execute(
        select(AssessmentPeriod).where(
            AssessmentPeriod.system_id == payload.system_id,
            AssessmentPeriod.period == payload.period,
        )
    )).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status_code=409, detail="Assessment period already exists")

    period = AssessmentPeriod(system_id=payload.system_id, period=payload.period, status="DRAFT")
    db.add(period)
    await db.commit()
    await db.refresh(period)
    return {"id": str(period.id), "system_id": str(period.system_id),
            "period": period.period, "status": period.status}


@router.get("/periods")
async def list_ai_periods(
    system_id: UUID | None = None,
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """Периоды оценки СИИ (только системы с system_kind=AI)."""
    stmt = (
        select(AssessmentPeriod, System)
        .join(System, AssessmentPeriod.system_id == System.id)
        .where(System.is_deleted.is_(False), System.system_kind == "AI")
        .order_by(AssessmentPeriod.created_at.desc())
    )
    if system_id is not None:
        stmt = stmt.where(AssessmentPeriod.system_id == system_id)
    rows = (await db.execute(stmt)).all()
    return [
        {"id": str(p.id), "system_id": str(s.id), "system_name": s.name,
         "period": p.period, "status": p.status}
        for p, s in rows
    ]


def _value_out(v: AiAssessmentValue) -> AiValueOut:
    meta = AI_SUB_INDEX.get((v.characteristic, v.subcharacteristic), {})
    return AiValueOut(
        id=str(v.id),
        group_name=v.group_name,
        characteristic=v.characteristic,
        subcharacteristic=v.subcharacteristic,
        metric_kind=v.metric_kind,
        inputs=v.inputs,
        baseline=float(v.baseline) if v.baseline is not None else None,
        tol_low=float(v.tol_low) if v.tol_low is not None else None,
        tol_high=float(v.tol_high) if v.tol_high is not None else None,
        raw_value=float(v.raw_value) if v.raw_value is not None else None,
        normalized_x=float(v.normalized_x) if v.normalized_x is not None else None,
        conformant=v.conformant,
        unmeasurable=bool(v.unmeasurable),
        expert_comment=v.expert_comment,
        is_ai_specific=bool(meta.get("is_ai_specific", False)),
    )


@router.get("/{period_id}/values", response_model=List[AiValueOut])
async def get_ai_values(period_id: UUID, db: AsyncSession = Depends(get_db)) -> list[AiValueOut]:
    await _require_ai_period(db, period_id)
    rows = (await db.execute(
        select(AiAssessmentValue).where(AiAssessmentValue.period_id == period_id)
        .order_by(AiAssessmentValue.group_name, AiAssessmentValue.characteristic, AiAssessmentValue.subcharacteristic)
    )).scalars().all()
    return [_value_out(v) for v in rows]


@router.put("/{period_id}/values", response_model=List[AiValueOut])
async def save_ai_values(
    period_id: UUID,
    payload: List[AiValueIn],
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_role(*_EDIT_ROLES)),
) -> list[AiValueOut]:
    """Upsert значений субхарактеристик: расчёт сырого значения, нормировка к baseline, вердикт.

    «Невозможно измерить» — комментарий обязателен (как в ISO-контуре).
    """
    await _require_ai_period(db, period_id)
    saved: list[AiAssessmentValue] = []
    for item in payload:
        key = (item.characteristic.strip(), item.subcharacteristic.strip())
        meta = AI_SUB_INDEX.get(key)
        if meta is None:
            raise HTTPException(
                status_code=422,
                detail=f"Пара не из модели 59898: {key[0]} / {key[1]}",
            )
        metric_kind = (item.metric_kind or meta["metric_kind"]).upper()
        if metric_kind not in METRIC_KINDS:
            raise HTTPException(status_code=422, detail=f"Неизвестный вид метрики: {metric_kind}")

        value = (await db.execute(
            select(AiAssessmentValue).where(
                AiAssessmentValue.period_id == period_id,
                AiAssessmentValue.characteristic == key[0],
                AiAssessmentValue.subcharacteristic == key[1],
            )
        )).scalar_one_or_none()
        if value is None:
            group = _group_of(key)
            value = AiAssessmentValue(
                period_id=period_id, group_name=group,
                characteristic=key[0], subcharacteristic=key[1], metric_kind=metric_kind,
            )
            db.add(value)

        value.metric_kind = metric_kind
        value.expert_comment = (item.expert_comment or "").strip() or None
        value.unmeasurable = bool(item.unmeasurable)
        value.baseline = item.baseline
        value.tol_low = item.tol_low
        value.tol_high = item.tol_high

        if value.unmeasurable:
            if not value.expert_comment:
                raise HTTPException(
                    status_code=422,
                    detail=f"«Невозможно измерить» ({key[1]}): обязателен комментарий с причиной",
                )
            value.inputs = None
            value.raw_value = None
            value.normalized_x = None
            value.conformant = None
        else:
            value.inputs = item.inputs or {}
            raw = ai_compute_metric(metric_kind, value.inputs)
            value.raw_value = raw
            if raw is None:
                value.normalized_x = None
                value.conformant = None
            else:
                x, conformant = ai_normalize_to_baseline(
                    raw,
                    float(item.baseline) if item.baseline is not None else None,
                    float(item.tol_low) if item.tol_low is not None else None,
                    float(item.tol_high) if item.tol_high is not None else None,
                )
                value.normalized_x = x
                value.conformant = conformant
        saved.append(value)

    period = await db.get(AssessmentPeriod, period_id)
    if period is not None and saved:
        period.status = "CALCULATED"
    await db.commit()
    for v in saved:
        await db.refresh(v)
    return [_value_out(v) for v in saved]


async def _load_weights(db: AsyncSession, period_id: UUID) -> tuple[dict, dict]:
    """Веса периода: ({характеристика: uₖ}, {характеристика: {субхар.: wᵢ}})."""
    rows = (await db.execute(
        select(AiWeight).where(AiWeight.period_id == period_id)
    )).scalars().all()
    char_weights: dict[str, float] = {}
    sub_weights: dict[str, dict[str, float]] = {}
    for w in rows:
        if w.scope == "CHARACTERISTIC":
            char_weights[w.name] = float(w.weight)
        elif w.scope.startswith("SUB:"):
            sub_weights.setdefault(w.scope[4:], {})[w.name] = float(w.weight)
    return char_weights, sub_weights


@router.get("/{period_id}/weights")
async def get_ai_weights(period_id: UUID, db: AsyncSession = Depends(get_db)) -> dict:
    await _require_ai_period(db, period_id)
    char_weights, sub_weights = await _load_weights(db, period_id)
    return {"period_id": str(period_id), "characteristics": char_weights, "subs": sub_weights}


@router.put("/{period_id}/weights")
async def save_ai_weights(
    period_id: UUID,
    payload: dict,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_role(*_EDIT_ROLES)),
) -> dict:
    """Сохранить веса свёртки (формулы 3–8). Валидация: Σ весов = 1 в каждом scope (±0.001).

    Формат: {"characteristics": {хар.: u}, "subs": {хар.: {субхар.: w}}}. Пустой словарь
    очищает веса соответствующего уровня (возврат к равным весам E1).
    """
    await _require_ai_period(db, period_id)
    char_weights: dict = payload.get("characteristics") or {}
    sub_weights: dict = payload.get("subs") or {}

    def check_sum(weights: dict, scope_label: str) -> None:
        if not weights:
            return
        total = sum(float(w) for w in weights.values())
        if abs(total - 1.0) > 0.001:
            raise HTTPException(
                status_code=422,
                detail=f"Σ весов в «{scope_label}» = {round(total, 4)}, требуется 1.0 (ГОСТ 59898, ф. 3–8)",
            )
        if any(float(w) < 0 for w in weights.values()):
            raise HTTPException(status_code=422, detail=f"Отрицательный вес в «{scope_label}»")

    check_sum(char_weights, "характеристики")
    for char_title, subs in sub_weights.items():
        check_sum(subs, char_title)

    # Полная замена весов периода (идемпотентный PUT).
    for w in (await db.execute(select(AiWeight).where(AiWeight.period_id == period_id))).scalars().all():
        await db.delete(w)
    for name, weight in char_weights.items():
        db.add(AiWeight(period_id=period_id, scope="CHARACTERISTIC", name=name, weight=float(weight)))
    for char_title, subs in sub_weights.items():
        for name, weight in subs.items():
            db.add(AiWeight(period_id=period_id, scope=f"SUB:{char_title}", name=name, weight=float(weight)))
    await db.commit()
    return {"status": "ok", "characteristics": len(char_weights),
            "subs": sum(len(s) for s in sub_weights.values())}


@router.post("/{period_id}/calculate", response_model=AiCalculationOut)
async def calculate_ai_period(period_id: UUID, db: AsyncSession = Depends(get_db)) -> AiCalculationOut:
    """Свёртка снизу вверх → интегральный Q ∈ [0,1] + K по характеристикам.

    E2: если на период заданы веса (Σ=1) — взвешенная свёртка по формулам 3–8, иначе равные веса.
    """
    await _require_ai_period(db, period_id)
    rows = (await db.execute(
        select(AiAssessmentValue).where(AiAssessmentValue.period_id == period_id)
    )).scalars().all()
    char_weights, sub_weights = await _load_weights(db, period_id)
    agg = ai_aggregate([
        {
            "characteristic": v.characteristic,
            "subcharacteristic": v.subcharacteristic,
            "normalized_x": float(v.normalized_x) if v.normalized_x is not None else None,
        }
        for v in rows
    ], char_weights or None, sub_weights or None)
    return AiCalculationOut(
        period_id=str(period_id),
        q=agg["q"],
        level=agg["level"],
        characteristics=agg["characteristics"],
        values_total=len(rows),
        values_measured=sum(1 for v in rows if v.normalized_x is not None),
        values_unmeasurable=sum(1 for v in rows if v.unmeasurable),
    )


@router.post("/{period_id}/finalize")
async def finalize_ai_period(
    period_id: UUID,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_role(*_EDIT_ROLES)),
) -> dict:
    """Завершение при полноте ВЫБРАННОГО представительного набора (п. 7.1.4).

    Набор субхарактеристик выбирается под конкретную СИИ (внесённые строки); finalize
    доступен, когда каждая внесённая строка рассчитана либо помечена «невозможно измерить».
    """
    period = await _require_ai_period(db, period_id)
    rows = (await db.execute(
        select(AiAssessmentValue).where(AiAssessmentValue.period_id == period_id)
    )).scalars().all()
    if not rows:
        raise HTTPException(status_code=409, detail="Набор пуст: внесите субхарактеристики представительного набора")
    incomplete = [
        f"{v.characteristic} / {v.subcharacteristic}"
        for v in rows if v.normalized_x is None and not v.unmeasurable
    ]
    if incomplete:
        raise HTTPException(
            status_code=409,
            detail="Не рассчитаны: " + "; ".join(incomplete[:5]) + ("…" if len(incomplete) > 5 else ""),
        )
    period.status = "COMPLETE"
    await db.commit()
    return {"id": str(period.id), "status": period.status, "values": len(rows)}


@router.get("/{period_id}/conformance-report", response_model=AiConformanceReport)
async def ai_conformance_report(period_id: UUID, db: AsyncSession = Depends(get_db)) -> AiConformanceReport:
    """Отчёт соответствия (критерий приёмки 7): значение, базовое, допуски, вердикт по каждой строке."""
    period = await _require_ai_period(db, period_id)
    system = await db.get(System, period.system_id)
    rows = (await db.execute(
        select(AiAssessmentValue).where(AiAssessmentValue.period_id == period_id)
        .order_by(AiAssessmentValue.group_name, AiAssessmentValue.characteristic)
    )).scalars().all()

    def verdict(v: AiAssessmentValue) -> str:
        if v.unmeasurable:
            return "Невозможно измерить"
        if v.raw_value is None:
            return "Не рассчитано"
        if v.conformant is None:
            return "Эталон не задан"
        return "В допуске" if v.conformant else "Вне допуска"

    report_rows = [
        AiConformanceRow(
            characteristic=v.characteristic,
            subcharacteristic=v.subcharacteristic,
            metric_kind=v.metric_kind,
            raw_value=float(v.raw_value) if v.raw_value is not None else None,
            baseline=float(v.baseline) if v.baseline is not None else None,
            tol_low=float(v.tol_low) if v.tol_low is not None else None,
            tol_high=float(v.tol_high) if v.tol_high is not None else None,
            normalized_x=float(v.normalized_x) if v.normalized_x is not None else None,
            verdict=verdict(v),
        )
        for v in rows
    ]
    char_weights, sub_weights = await _load_weights(db, period_id)
    agg = ai_aggregate([
        {"characteristic": v.characteristic, "subcharacteristic": v.subcharacteristic,
         "normalized_x": float(v.normalized_x) if v.normalized_x is not None else None}
        for v in rows
    ], char_weights or None, sub_weights or None)
    return AiConformanceReport(
        period_id=str(period_id),
        system_name=system.name if system else str(period.system_id),
        period=period.period,
        q=agg["q"],
        level=agg["level"],
        rows=report_rows,
        conformant_count=sum(1 for r in report_rows if r.verdict == "В допуске"),
        nonconformant_count=sum(1 for r in report_rows if r.verdict == "Вне допуска"),
        no_baseline_count=sum(1 for r in report_rows if r.verdict == "Эталон не задан"),
    )


def _group_of(key: tuple[str, str]) -> str:
    from app.modules.quality.ai_quality_model import AI_QUALITY_FLAT
    for group, char, sub, *_ in AI_QUALITY_FLAT:
        if (char, sub) == key:
            return group
    return "—"


async def _require_ai_period(db: AsyncSession, period_id: UUID) -> AssessmentPeriod:
    period = await db.get(AssessmentPeriod, period_id)
    if period is None:
        raise HTTPException(status_code=404, detail="Assessment period not found")
    system = await db.get(System, period.system_id)
    if system is None or (system.system_kind or "CLASSIC") != "AI":
        raise HTTPException(status_code=409, detail="Период не относится к системе ИИ (контур 59898)")
    return period
