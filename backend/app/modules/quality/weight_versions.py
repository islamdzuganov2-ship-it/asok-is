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
from app.modules.quality.weights import (
    CHARACTERISTIC_WEIGHTS,
    CRITICALITY_PROFILES,
    DEFAULT_CHAR_WEIGHTS,
    DEFAULT_SUBCHAR_WITHIN_CHAR,
    SUBCHAR_WEIGHTS,
)
from app.modules.systems import System
from app.shared.exceptions import ValidationError

# В-6а: предложено заказчику, ждёт подтверждения (docs/ТЗ_19 §0 Р-6, §4 «Новые вопросы»).
# Ключи — CriticalityClass.value (через пробел, как хранится на System), не .name.
DEFAULT_CRITICALITY_WEIGHTS: dict[str, float] = {
    "MISSION CRITICAL": 3.0,
    "BUSINESS CRITICAL": 2.0,
    "BUSINESS OPERATIONAL": 1.0,
}


def current_subchar_snapshot() -> dict[str, list[list]]:
    """w-уровень (подхарактеристика ВНУТРИ характеристики, Σ=100 на характеристику), одинаково
    для всех профилей критичности при первом посеве — см. weights.py про честность цифр без
    решения заказчика о различиях профилей."""
    rows = [[c, s, w] for (c, s), w in DEFAULT_SUBCHAR_WITHIN_CHAR.items()]
    return {profile: [list(r) for r in rows] for profile in CRITICALITY_PROFILES}


def current_char_snapshot() -> dict[str, dict[str, float]]:
    """u-уровень (характеристика → интегральный Q, Σ=100 на профиль)."""
    return {profile: dict(DEFAULT_CHAR_WEIGHTS) for profile in CRITICALITY_PROFILES}


def combined_weights_for_version(version: WeightSetVersion) -> dict[str, dict[tuple[str, str], float]]:
    """Разворачивает версию в готовые для weighted_system_score веса — по каждому профилю
    отдельно, u(char)×w(sub|char)/100. Считается ОДИН РАЗ на запрос дашборда (не на каждую ИС —
    сама версия одна на все системы, дорого пересчитывать N раз в цикле по системам)."""
    char_w = version.char_weights or {}
    sub_w = version.subchar_weights or {}
    out: dict[str, dict[tuple[str, str], float]] = {}
    for profile in CRITICALITY_PROFILES:
        cw = char_w.get(profile) or DEFAULT_CHAR_WEIGHTS
        rows = sub_w.get(profile) or []
        out[profile] = {(c, s): round(cw.get(c, 0.0) * w / 100, 6) for c, s, w in rows}
    return out


def weight_for(
    weights_by_profile: dict[str, dict[tuple[str, str], float]],
    profile: str | None,
    characteristic: str,
    subcharacteristic: str,
) -> float:
    """Вес подхарактеристики для системы данного профиля критичности. Профиль вне известных
    трёх (не должно случиться — CriticalityClass закрытый enum из 3 значений) — откат на
    BUSINESS OPERATIONAL как наименее агрессивный профиль, не на 0 молча."""
    by_pair = weights_by_profile.get(profile) or weights_by_profile.get("BUSINESS OPERATIONAL") or {}
    if (characteristic, subcharacteristic) in by_pair:
        return by_pair[(characteristic, subcharacteristic)]
    return SUBCHAR_WEIGHTS.get((characteristic, subcharacteristic), 0.0)


def _same_content(
    version: WeightSetVersion, subchar_snapshot: dict[str, list[list]],
    char_snapshot: dict[str, dict[str, float]], crit: dict[str, float],
) -> bool:
    def _norm_sub(snapshot: dict[str, list[list]]) -> dict[str, dict[tuple[str, str], float]]:
        # До УК-04/05 subchar_weights была плоским списком (не {profile: [...]}) — строка,
        # заведённая старым кодом, не «совпадает» с новой по-профильной формой, а требует
        # переиздания версии, не падения на .items() плоского списка.
        if not isinstance(snapshot, dict):
            return {}
        return {p: {(r[0], r[1]): r[2] for r in rows} for p, rows in snapshot.items()}

    existing_sub = _norm_sub(version.subchar_weights or {})
    candidate_sub = _norm_sub(subchar_snapshot)
    existing_char = {p: dict(v) for p, v in (version.char_weights or {}).items()} if isinstance(version.char_weights, dict) else {}
    return (
        existing_sub == candidate_sub
        and existing_char == char_snapshot
        and dict(version.criticality_weights or {}) == crit
    )


async def get_active_version(db: AsyncSession) -> WeightSetVersion | None:
    return (
        await db.execute(select(WeightSetVersion).where(WeightSetVersion.is_active.is_(True)))
    ).scalar_one_or_none()


async def list_versions(db: AsyncSession) -> list[WeightSetVersion]:
    """История версий весов, новые сверху (УК-07: «история изменений, кто и когда»)."""
    return list(
        (await db.execute(select(WeightSetVersion).order_by(WeightSetVersion.created_at.desc())))
        .scalars().all()
    )


async def _publish_version_from_code(db: AsyncSession, created_by: uuid.UUID | None = None) -> WeightSetVersion:
    """Публикует версию из ТЕКУЩЕГО кода (weights.py) поверх активной (если была). Только для
    бутстрапа (версий ещё нет вовсе) и явного пересчёта (recompute_and_snapshot, apply=True) —
    НЕ вызывается на каждое чтение, см. предупреждение в ensure_active_version."""
    active = await get_active_version(db)
    if active is not None:
        active.is_active = False
    new_version = WeightSetVersion(
        id=uuid.uuid4(),
        label=f"gost-25010-file-{datetime.now(timezone.utc):%Y%m%d-%H%M%S}",
        subchar_weights=current_subchar_snapshot(),
        char_weights=current_char_snapshot(),
        criticality_weights=dict(DEFAULT_CRITICALITY_WEIGHTS),
        is_active=True,
        created_by=created_by,
        note="Веса из файла заказчика (веса характеристик_2.xlsx, ГОСТ 25010-2015).",
    )
    db.add(new_version)
    await db.commit()
    await db.refresh(new_version)
    return new_version


async def ensure_active_version(db: AsyncSession, created_by: uuid.UUID | None = None) -> WeightSetVersion:
    """Гарантирует наличие активной версии. Если она УЖЕ есть (в том числе с ручной правкой
    редактора весов) — возвращает КАК ЕСТЬ, не сверяя с текущим кодом weights.py. Публикация
    версии из кода — только при бутстрапе (версий ещё нет вовсе).

    ВАЖНО (регресс 2026-08-17): раньше эта функция на КАЖДЫЙ вызов сверяла активную версию с
    хардкодным файлом и молча переиздавала версию из кода при малейшем расхождении — то есть
    любая ручная правка через редактор весов стиралась на следующей же загрузке дашборда
    (assessment/router.py тоже вызывает ensure_active_version). «Обновился файл заказчика —
    нужна новая версия» — это ЯВНОЕ решение администратора, см. POST /weights/recompute
    (apply=True), не побочный эффект обычного чтения.

    Исключение — форма ДО УК-04/05 (subchar_weights был плоским списком, не {profile: {...}}):
    такую строку читать новым кодом нельзя (упадёт на .get() дальше по цепочке), она переиздаётся
    даже без явного recompute — это не «правка отличается от файла», а «формат нечитаем»."""
    active = await get_active_version(db)
    if active is not None and isinstance(active.subchar_weights, dict) and isinstance(active.char_weights, dict):
        return active
    return await _publish_version_from_code(db, created_by=created_by)


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
class _RawBucket:
    """(ИС, период) с сырыми точками (характеристика, подхарактеристика, X) — БЕЗ веса. Вес
    применяется отдельным шагом (_apply_weights), чтобы предпросмотр правки (preview_weight_edit)
    мог посчитать «было/станет» по ОДНИМ и тем же измерениям, не дёргая БД дважды."""
    system_id: uuid.UUID
    system_name: str
    period_id: uuid.UUID
    period_label: str
    profile: str
    points: list[tuple[str, str, float | None]] = field(default_factory=list)


def _apply_weights(bucket: _RawBucket, weights_by_profile: dict[str, dict[tuple[str, str], float]]):
    subchars = [
        SubcharScore(c, s, weight_for(weights_by_profile, bucket.profile, c, s), x)
        for c, s, x in bucket.points
    ]
    return weighted_system_score(subchars)


async def _collect_raw_buckets(db: AsyncSession) -> list[_RawBucket]:
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

    buckets: dict[tuple, _RawBucket] = {}
    for value, period, system, metric in rows:
        key = (system.id, period.id)
        bucket = buckets.get(key)
        if bucket is None:
            profile = system.criticality_class.value if hasattr(system.criticality_class, "value") else str(system.criticality_class)
            bucket = _RawBucket(
                system_id=system.id, system_name=system.name,
                period_id=period.id, period_label=period.period, profile=profile,
            )
            buckets[key] = bucket
        canon = canonical_characteristic(metric.characteristic)
        if canon is None:
            continue
        if (canon, metric.subcharacteristic) not in SUBCHAR_WEIGHTS:
            continue  # подхарактеристика вне 31 канонической — не участвует во взвешенном балле
        x = None if (value.unmeasurable or value.calculated_x is None) else float(value.calculated_x) * 100
        bucket.points.append((canon, metric.subcharacteristic, x))
    return list(buckets.values())


async def recompute_and_snapshot(
    db: AsyncSession, *, apply: bool, created_by: uuid.UUID | None = None,
) -> RecomputeReport:
    """Пересчитывает Балл_ИС под текущими весами для КАЖДОГО (ИС, период) с данными, сравнивает
    с последним снапшотом (если был) — отчёт «до/после» ДО записи. apply=False (по умолчанию) —
    ничего не пишет и не активирует версию. apply=True — активирует версию (если изменилась) и
    записывает снапшоты."""
    candidate_sub = current_subchar_snapshot()
    candidate_char = current_char_snapshot()
    candidate_crit = dict(DEFAULT_CRITICALITY_WEIGHTS)
    active = await get_active_version(db)
    version_for_report = active
    if active is None or not _same_content(active, candidate_sub, candidate_char, candidate_crit):
        if apply:
            # Расхождение с кодом ЕСТЬ и apply=True — явное решение администратора публикует
            # версию из файла заказчика (не ensure_active_version: та больше не переиздаёт
            # версию при расхождении, чтобы не стирать ручные правки редактора весов).
            version_for_report = await _publish_version_from_code(db, created_by=created_by)
        else:
            # dry-run: отчёт нужен ДО создания версии — используем временный id-плейсхолдер.
            version_for_report = WeightSetVersion(
                id=uuid.uuid4(), label="(предпросмотр, не сохранено)",
                subchar_weights=candidate_sub, char_weights=candidate_char,
                criticality_weights=candidate_crit, is_active=False,
            )

    weights_by_profile = combined_weights_for_version(version_for_report)
    buckets = await _collect_raw_buckets(db)

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
        breakdown = _apply_weights(bucket, weights_by_profile)
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


# ═══════════════════════ Редактор весов (УК-04/05/07) ═══════════════════════

def _validate_char_weights(char_weights: dict[str, float]) -> list[str]:
    known = set(CHARACTERISTIC_WEIGHTS.keys())
    given = set(char_weights.keys())
    errors: list[str] = []
    missing = known - given
    unknown = given - known
    if missing:
        errors.append("Не заданы веса характеристик (u): " + ", ".join(sorted(missing)))
    if unknown:
        errors.append("Неизвестные характеристики: " + ", ".join(sorted(unknown)))
    total = sum(char_weights.get(c, 0.0) for c in known)
    if abs(total - 100) > 0.05:
        errors.append(f"Сумма весов характеристик (u) = {round(total, 2)}, должна быть 100")
    return errors


def _validate_subchar_within(subchar_within: dict[tuple[str, str], float]) -> list[str]:
    known_pairs = set(SUBCHAR_WEIGHTS.keys())
    given_pairs = set(subchar_within.keys())
    errors: list[str] = []
    missing = known_pairs - given_pairs
    unknown = given_pairs - known_pairs
    if missing:
        errors.append("Не заданы веса подхарактеристик: " + ", ".join(f"{c} / {s}" for c, s in sorted(missing)))
    if unknown:
        errors.append("Неизвестные подхарактеристики: " + ", ".join(f"{c} / {s}" for c, s in sorted(unknown)))
    by_char: dict[str, float] = defaultdict(float)
    for (c, s), w in subchar_within.items():
        if (c, s) in known_pairs:
            by_char[c] += w
    for c in sorted(CHARACTERISTIC_WEIGHTS.keys()):
        total = by_char.get(c, 0.0)
        if abs(total - 100) > 0.05:
            errors.append(f"«{c}»: сумма весов подхарактеристик (w) = {round(total, 2)}, должна быть 100")
    return errors


def validate_weight_edit(
    char_weights: dict[str, float], subchar_within: dict[tuple[str, str], float],
) -> list[str]:
    """Σ=100 на каждом уровне (u — по профилю, w — внутри каждой характеристики). Ошибки
    указывают конкретную характеристику/строку (критерий приёмки), не общее «данные некорректны»."""
    return _validate_char_weights(char_weights) + _validate_subchar_within(subchar_within)


def _merged_snapshot(active: WeightSetVersion, profile: str, char_weights: dict[str, float],
                      subchar_within: dict[tuple[str, str], float]) -> tuple[dict, dict]:
    """Остальные профили — как в активной версии, редактируемый — заменён целиком."""
    new_sub = {p: [list(r) for r in (active.subchar_weights or {}).get(p, [])] for p in CRITICALITY_PROFILES}
    new_char = {p: dict((active.char_weights or {}).get(p, {})) for p in CRITICALITY_PROFILES}
    new_sub[profile] = [[c, s, w] for (c, s), w in subchar_within.items()]
    new_char[profile] = dict(char_weights)
    return new_sub, new_char


async def save_weight_edit(
    db: AsyncSession, *, profile: str, char_weights: dict[str, float],
    subchar_within: dict[tuple[str, str], float], note: str | None, created_by: uuid.UUID | None,
) -> WeightSetVersion:
    """Сохраняет правку ОДНОГО профиля критичности — остальные два переносятся из активной
    версии без изменений. Валидация — обязанность вызывающего роутера, ДО вызова этой функции
    (отдаёт 422 со списком ошибок по строкам, не откатывает частично записанное)."""
    if profile not in CRITICALITY_PROFILES:
        raise ValidationError(f"Неизвестный профиль критичности: {profile}")

    active = await ensure_active_version(db, created_by=created_by)
    new_sub, new_char = _merged_snapshot(active, profile, char_weights, subchar_within)

    active.is_active = False
    new_version = WeightSetVersion(
        id=uuid.uuid4(),
        label=f"ручная правка ({profile}) {datetime.now(timezone.utc):%Y-%m-%d %H:%M}",
        subchar_weights=new_sub, char_weights=new_char,
        criticality_weights=dict(active.criticality_weights or DEFAULT_CRITICALITY_WEIGHTS),
        is_active=True, created_by=created_by, note=note,
    )
    db.add(new_version)
    await db.commit()
    await db.refresh(new_version)
    return new_version


async def preview_weight_edit(
    db: AsyncSession, *, profile: str, char_weights: dict[str, float],
    subchar_within: dict[tuple[str, str], float],
) -> RecomputeReport:
    """«Как изменится Score портфеля» — до/после по ОДНИМ И ТЕМ ЖЕ измерениям (сырые точки не
    зависят от весов), без записи. Затрагивает только системы с этим профилем критичности —
    системы других профилей закономерно попадают в unchanged (их веса не менялись)."""
    if profile not in CRITICALITY_PROFILES:
        raise ValidationError(f"Неизвестный профиль критичности: {profile}")

    active = await ensure_active_version(db)
    old_weights_by_profile = combined_weights_for_version(active)
    new_sub, new_char = _merged_snapshot(active, profile, char_weights, subchar_within)
    preview_version = WeightSetVersion(
        id=uuid.uuid4(), label="(предпросмотр, не сохранено)",
        subchar_weights=new_sub, char_weights=new_char,
        criticality_weights=dict(active.criticality_weights or DEFAULT_CRITICALITY_WEIGHTS),
        is_active=False,
    )
    new_weights_by_profile = combined_weights_for_version(preview_version)

    buckets = await _collect_raw_buckets(db)
    changed: list[PeriodScoreDelta] = []
    unchanged = 0
    for bucket in buckets:
        old_score = _apply_weights(bucket, old_weights_by_profile).score
        new_score = _apply_weights(bucket, new_weights_by_profile).score
        if old_score != new_score:
            delta = None if (old_score is None or new_score is None) else round(new_score - old_score, 4)
            changed.append(PeriodScoreDelta(
                system_name=bucket.system_name, period=bucket.period_label,
                previous_score=old_score, new_score=new_score, delta=delta,
            ))
        else:
            unchanged += 1
    changed.sort(key=lambda d: abs(d.delta or 0), reverse=True)

    return RecomputeReport(
        applied=False, weight_version_id=preview_version.id,
        periods_scored=len(buckets), unchanged_count=unchanged,
        changed=changed, newly_scored=[],
    )
