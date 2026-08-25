"""
Динамика портфельных величин (ТЗ v21, КП-12) — материал для кокпитов CEO/CTO.

Слайд 11 обещает детектор аномалий (≥ 12 п.п. между периодами) и его код действительно есть
(reporting/router.py, per-ИС «Динамика качества»), но только на уровне ОДНОЙ системы. На уровне
портфеля дельты не считает ни один эндпоинт — без них ни одна плитка кокпита не может ответить
на «стало лучше или хуже», хотя это первый вопрос руководителя.

Честная граница объёма (§7.3 ТЗ, честная пустота): исторический ряд существует только там,
где данные периодизированы или естественно бьются на окна:
  · metric='score'         — по AssessmentPeriod/AssessmentValue (простое среднее по портфелю,
                              НЕ взвешенный по весам ГОСТ балл — тот считается по-другому и
                              только для последнего периода; здесь — сопоставимый прокси-ряд);
  · metric='availability'  — по TechIncident, бакетами по кварталам (downtime/окно);
  · metric='ale'|'closure' — снимков по периодам не существует (RiskEvent.ale_avg — текущее
                              значение, не история); возвращается пустой ряд с honest-причиной,
                              а не выдуманное число.
"""
from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.assessment import AssessmentPeriod, AssessmentValue
from app.modules.econ.schemas import PortfolioTrendOut, TrendPointOut
from app.modules.incidents import TechIncident
from app.modules.systems import System
from app.shared.periods import period_sort_key

ANOMALY_THRESHOLD_PP = 12.0  # слайд 11 — тот же порог, что и для отдельной ИС


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _quarter_label(dt: datetime) -> str:
    q = (dt.month - 1) // 3 + 1
    return f"{dt.year}-Q{q}"


async def _criticality_system_ids(db: AsyncSession, criticality: list[str] | None) -> set[uuid.UUID] | None:
    if not criticality:
        return None
    systems = (await db.execute(select(System))).scalars().all()
    return {s.id for s in systems if s.criticality_class.value in criticality}


async def _score_trend(
    db: AsyncSession, system_id: list[uuid.UUID] | None, criticality: list[str] | None, periods: int,
) -> PortfolioTrendOut:
    stmt = (
        select(AssessmentPeriod.period, AssessmentValue.calculated_x, AssessmentPeriod.system_id)
        .join(AssessmentValue, AssessmentValue.period_id == AssessmentPeriod.id)
        .where(AssessmentValue.calculated_x.is_not(None))
    )
    if system_id is not None:
        stmt = stmt.where(AssessmentPeriod.system_id.in_(system_id))
    crit_ids = await _criticality_system_ids(db, criticality)
    rows = (await db.execute(stmt)).all()
    if crit_ids is not None:
        rows = [r for r in rows if r[2] in crit_ids]
    if not rows:
        return PortfolioTrendOut(
            metric="score", points=[], empty_reason="Нет ни одного посчитанного значения метрики",
        )

    by_period: dict[str, list[float]] = defaultdict(list)
    for period_label, x, _sid in rows:
        by_period[period_label].append(float(x))

    ordered_labels = sorted(by_period.keys(), key=period_sort_key)[-periods:]
    points = [
        TrendPointOut(period=lbl, value=round(sum(by_period[lbl]) / len(by_period[lbl]), 1))
        for lbl in ordered_labels
    ]
    return _finalize("score", points)


async def _availability_trend(
    db: AsyncSession, system_id: list[uuid.UUID] | None, criticality: list[str] | None, periods: int,
) -> PortfolioTrendOut:
    stmt = select(TechIncident)
    if system_id is not None:
        stmt = stmt.where(TechIncident.system_id.in_(system_id))
    rows = list((await db.execute(stmt)).scalars().all())
    crit_ids = await _criticality_system_ids(db, criticality)
    if crit_ids is not None:
        rows = [r for r in rows if r.system_id in crit_ids]
    if not rows:
        return PortfolioTrendOut(
            metric="availability", points=[], empty_reason="Нет зарегистрированных технических сбоев",
        )

    by_q: dict[str, list[TechIncident]] = defaultdict(list)
    for r in rows:
        occurred = r.occurred_at if r.occurred_at.tzinfo else r.occurred_at.replace(tzinfo=timezone.utc)
        by_q[_quarter_label(occurred)].append(r)

    ordered_labels = sorted(by_q.keys())[-periods:]
    quarter_hours = 90 * 24.0
    points = []
    for lbl in ordered_labels:
        downtime_hours = sum(float(r.downtime_minutes or 0) for r in by_q[lbl]) / 60
        avail = max(0.0, min(100.0, 100 * (1 - downtime_hours / quarter_hours)))
        points.append(TrendPointOut(period=lbl, value=round(avail, 2)))
    return _finalize("availability", points)


def _finalize(metric: str, points: list[TrendPointOut]) -> PortfolioTrendOut:
    if len(points) < 2:
        return PortfolioTrendOut(
            metric=metric, points=points,
            empty_reason=None if points else "Недостаточно периодов для сравнения",
        )
    prev, last = points[-2].value, points[-1].value
    delta_abs = round(last - prev, 2)
    delta_rel = round(delta_abs / prev * 100, 1) if prev else None
    anomaly = abs(delta_abs) >= ANOMALY_THRESHOLD_PP if metric == "score" else False
    return PortfolioTrendOut(
        metric=metric, points=points, delta_absolute=delta_abs, delta_relative=delta_rel, anomaly=anomaly,
    )


async def portfolio_trend(
    db: AsyncSession, *, metric: str, periods: int = 6,
    system_id: list[uuid.UUID] | None = None, criticality: list[str] | None = None,
) -> PortfolioTrendOut:
    if metric == "score":
        return await _score_trend(db, system_id, criticality, periods)
    if metric == "availability":
        return await _availability_trend(db, system_id, criticality, periods)
    if metric in ("ale", "closure"):
        return PortfolioTrendOut(
            metric=metric, points=[],
            empty_reason="История по периодам не хранится: значение текущее, снимков нет (см. ТЗ v21 §10.2)",
        )
    return PortfolioTrendOut(metric=metric, points=[], empty_reason=f"Неизвестная метрика «{metric}»")
