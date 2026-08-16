"""ТЗ v19 УК-05/06 — версии весов и пересчёт истории (Р-3: «пересчитать всю историю»).

Дашборд (assessment/router.py) считает баллы ЖИВЬЁМ под ТЕКУЩИМИ активными весами при каждом
запросе — как и раньше, без нового кеша и без просадки перформанса. Эта версия/снапшот-система
не заменяет живой расчёт, она отвечает на другой вопрос: «под какими именно весами был получен
ИМЕННО ЭТОТ балл в ИМЕННО ЭТОМ периоде» — то есть даёт обратимость и объяснимость, а не скорость.

Критичность вынесена КОНСТАНТОЙ (DEFAULT_CRITICALITY_WEIGHTS), не полем EconConfig: перенос
в econ создал бы обратную зависимость quality→econ (econ УЖЕ зависит от quality через
QUALITY_MODEL, наоборот нельзя — правило слоёв модульного монолита). В-6а (3/2/1) — предложение
на согласование, не финальное решение заказчика; менять — здесь, одной константой.
"""
from __future__ import annotations

import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.assessment import AssessmentPeriod, AssessmentValue
from app.modules.quality.models import MetricCatalog, ScoreHistorySnapshot, WeightSetVersion
from app.modules.quality.quality_model import canonical_characteristic
from app.modules.quality.scoring import SubcharScore, weighted_system_score
from app.modules.quality.weights import SUBCHAR_WEIGHTS
from app.modules.systems import System

# В-6а: предложено заказчику, ждёт подтверждения (docs/ТЗ_19 §0 Р-6, §4 «Новые вопросы»).
# Ключи — CriticalityClass.value (через пробел, как хранится на System), не .name.
DEFAULT_CRITICALITY_WEIGHTS: dict[str, float] = {
    "MISSION CRITICAL": 3.0,
    "BUSINESS CRITICAL": 2.0,
    "BUSINESS OPERATIONAL": 1.0,
}


def current_weight_snapshot() -> list[list]:
    return [[c, s, w] for (c, s), w in SUBCHAR_WEIGHTS.items()]


def _same_content(version: WeightSetVersion, weights_snapshot: list[list], crit: dict[str, float]) -> bool:
    existing_weights = {(row[0], row[1]): row[2] for row in (version.subchar_weights or [])}
    candidate_weights = {(row[0], row[1]): row[2] for row in weights_snapshot}
    return existing_weights == candidate_weights and dict(version.criticality_weights or {}) == crit


async def get_active_version(db: AsyncSession) -> WeightSetVersion | None:
    return (
        await db.execute(select(WeightSetVersion).where(WeightSetVersion.is_active.is_(True)))
    ).scalar_one_or_none()


async def ensure_active_version(db: AsyncSession, created_by: uuid.UUID | None = None) -> WeightSetVersion:
    """Гарантирует активную версию, синхронную с текущим `quality.weights` (файл заказчика).
    Идемпотентно: не меняет ничего, если содержимое не изменилось с прошлого вызова."""
    active = await get_active_version(db)
    candidate_weights = current_weight_snapshot()
    candidate_crit = dict(DEFAULT_CRITICALITY_WEIGHTS)

    if active is not None and _same_content(active, candidate_weights, candidate_crit):
        return active

    if active is not None:
        active.is_active = False

    new_version = WeightSetVersion(
        id=uuid.uuid4(),
        label=f"gost-25010-file-{datetime.now(timezone.utc):%Y%m%d-%H%M%S}",
        subchar_weights=candidate_weights,
        criticality_weights=candidate_crit,
        is_active=True,
        created_by=created_by,
        note="Веса из файла заказчика (веса характеристик_2.xlsx, ГОСТ 25010-2015).",
    )
    db.add(new_version)
    await db.commit()
    await db.refresh(new_version)
    return new_version


# ═══════════════════════ Пересчёт истории (Р-3) ═══════════════════════

class _CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)


class PeriodScoreDelta(_CamelModel):
    system_name: str
    period: str
    previous_score: float | None
    new_score: float | None
    delta: float | None


class RecomputeReport(_CamelModel):
    applied: bool
    weight_version_id: uuid.UUID
    periods_scored: int
    unchanged_count: int
    changed: list[PeriodScoreDelta]
    newly_scored: list[PeriodScoreDelta]  # были без снапшота вовсе (первый пересчёт)


@dataclass
class _PeriodBucket:
    system_id: uuid.UUID
    system_name: str
    period_id: uuid.UUID
    period_label: str
    subchars: list[SubcharScore] = field(default_factory=list)


async def _collect_period_buckets(db: AsyncSession) -> list[_PeriodBucket]:
    """Все (ИС, период) с хотя бы одним измеренным/unmeasurable значением — не только
    последний период на ИС, в отличие от /assessments/dashboard: история пересчитывается ВСЯ."""
    rows = (
        await db.execute(
            select(AssessmentValue, AssessmentPeriod, System, MetricCatalog)
            .join(AssessmentPeriod, AssessmentValue.period_id == AssessmentPeriod.id)
            .join(System, AssessmentPeriod.system_id == System.id)
            .join(MetricCatalog, AssessmentValue.metric_id == MetricCatalog.id)
            .where(
                System.is_active.is_(True), System.is_deleted.is_(False),
                or_(AssessmentValue.calculated_x.isnot(None), AssessmentValue.unmeasurable.is_(True)),
            )
        )
    ).all()

    buckets: dict[tuple, _PeriodBucket] = {}
    for value, period, system, metric in rows:
        key = (system.id, period.id)
        bucket = buckets.get(key)
        if bucket is None:
            bucket = _PeriodBucket(
                system_id=system.id, system_name=system.name,
                period_id=period.id, period_label=period.period,
            )
            buckets[key] = bucket
        canon = canonical_characteristic(metric.characteristic)
        if canon is None:
            continue
        weight = SUBCHAR_WEIGHTS.get((canon, metric.subcharacteristic))
        if weight is None:
            continue  # подхарактеристика вне 31 канонической — не участвует во взвешенном балле
        x = None if (value.unmeasurable or value.calculated_x is None) else float(value.calculated_x) * 100
        bucket.subchars.append(SubcharScore(canon, metric.subcharacteristic, weight, x))
    return list(buckets.values())


async def recompute_and_snapshot(
    db: AsyncSession, *, apply: bool, created_by: uuid.UUID | None = None,
) -> RecomputeReport:
    """Пересчитывает Балл_ИС под текущими весами для КАЖДОГО (ИС, период) с данными, сравнивает
    с последним снапшотом (если был) — отчёт «до/после» ДО записи. apply=False (по умолчанию) —
    ничего не пишет и не активирует версию. apply=True — активирует версию (если изменилась) и
    записывает снапшоты."""
    buckets = await _collect_period_buckets(db)

    candidate_weights = current_weight_snapshot()
    candidate_crit = dict(DEFAULT_CRITICALITY_WEIGHTS)
    active = await get_active_version(db)
    version_for_report = active
    if active is None or not _same_content(active, candidate_weights, candidate_crit):
        if apply:
            version_for_report = await ensure_active_version(db, created_by=created_by)
        else:
            # dry-run: отчёт нужен ДО создания версии — используем временный id-плейсхолдер.
            version_for_report = WeightSetVersion(
                id=uuid.uuid4(), label="(предпросмотр, не сохранено)",
                subchar_weights=candidate_weights, criticality_weights=candidate_crit,
                is_active=False,
            )

    prev_by_key: dict[tuple, ScoreHistorySnapshot] = {}
    if active is not None:
        prev_rows = (
            await db.execute(
                select(ScoreHistorySnapshot).where(ScoreHistorySnapshot.weight_version_id == active.id)
            )
        ).scalars().all()
        for row in prev_rows:
            prev_by_key[(row.system_id, row.period_id)] = row

    changed: list[PeriodScoreDelta] = []
    newly_scored: list[PeriodScoreDelta] = []
    unchanged = 0
    now = datetime.now(timezone.utc)
    new_snapshots: list[ScoreHistorySnapshot] = []

    for bucket in buckets:
        breakdown = weighted_system_score(bucket.subchars)
        prev = prev_by_key.get((bucket.system_id, bucket.period_id))
        prev_score = float(prev.score) if prev and prev.score is not None else None

        if prev is None:
            if breakdown.score is not None:
                newly_scored.append(PeriodScoreDelta(
                    system_name=bucket.system_name, period=bucket.period_label,
                    previous_score=None, new_score=breakdown.score, delta=None,
                ))
        elif prev_score != breakdown.score:
            delta = None if (prev_score is None or breakdown.score is None) else round(breakdown.score - prev_score, 4)
            changed.append(PeriodScoreDelta(
                system_name=bucket.system_name, period=bucket.period_label,
                previous_score=prev_score, new_score=breakdown.score, delta=delta,
            ))
        else:
            unchanged += 1

        if apply:
            new_snapshots.append(ScoreHistorySnapshot(
                id=uuid.uuid4(), weight_version_id=version_for_report.id,
                period_id=bucket.period_id, system_id=bucket.system_id, system_name=bucket.system_name,
                score=breakdown.score, coverage=breakdown.coverage,
                breakdown={"contributions": breakdown.contributions, "weightApplied": breakdown.weight_applied,
                          "weightTotal": breakdown.weight_total},
                computed_at=now,
            ))

    if apply and new_snapshots:
        for row in new_snapshots:
            db.add(row)
        await db.commit()

    changed.sort(key=lambda d: abs(d.delta or 0), reverse=True)

    return RecomputeReport(
        applied=apply,
        weight_version_id=version_for_report.id,
        periods_scored=len(buckets),
        unchanged_count=unchanged,
        changed=changed,
        newly_scored=newly_scored,
    )
