"""
Нагрузка на исполнителей и балансировка (ТЗ v19 п.13, УК-31, УК-32, УК-33).

УК-31 — вес меры: характеристика (вес ГОСТ) × критичность ИС × трудоёмкость в часах
(`quality.measure_weight`). Вес раскладывается на множители прямо в ответе — «видно, из чего
сложился вес конкретной меры».
УК-32 — нагрузка = Σ весов открытых мер исполнителя с разложением: сколько мер, суммарные часы и
вес, сколько просрочено, сколько по критичным ИС. Меры без оценки часов (ещё не взяты «в работу»,
В-41) — отдельным счётчиком, не нулём.
УК-33 — балансировка: норма часов на исполнителя (EconConfig `executor_load_norm_hours`, зависит
от размера предприятия — УК-22), статусы «перегружен / в норме / свободен», рекомендации по
передаче мер от перегруженных к свободным и предупреждение при назначении меры перегруженному.

Норма считается в ЧАСАХ, а сравнение исполнителей между собой — по ВЕСУ: «15 лёгких против
5 сложных» различает вес, а «успеет ли человек» — часы. Это две разные величины, и экран
показывает обе, а не одну свёрнутую.
"""
from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import datetime, timezone

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.governance.models import EXECUTION_DONE, STATUS_APPROVED, STATUS_PENDING, Proposal
from app.modules.iam import User
from app.modules.quality import (
    CHARACTERISTIC_WEIGHTS,
    DEFAULT_CRITICALITY_WEIGHTS,
    canonical_characteristic,
    measure_weight,
)
from app.modules.systems import System

STATE_OVERLOADED = "overloaded"
STATE_NORMAL = "normal"
STATE_FREE = "free"
FREE_SHARE = 0.5          # меньше половины нормы и без просрочек — свободен
DEFAULT_NORM_HOURS = 160.0
EXECUTOR_ROLE = "EXECUTOR"


class _CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)


class LoadMeasureOut(_CamelModel):
    proposal_id: uuid.UUID
    title: str
    system: str
    characteristic: str | None = None
    criticality: str | None = None
    hours: float | None = None
    weight: float | None = None
    weight_explained: str          # УК-31: из чего сложился вес
    overdue: bool
    due_on: datetime | None = None


class ExecutorLoadRowOut(_CamelModel):
    owner: str
    open_measures: int
    hours: float
    weighted_load: float
    without_estimate: int
    overdue: int
    on_critical_systems: int
    norm_hours: float
    load_pct: float
    state: str
    measures: list[LoadMeasureOut]


class RebalanceHintOut(_CamelModel):
    proposal_id: uuid.UUID
    title: str
    from_owner: str
    to_owner: str
    hours: float
    reason: str


class ExecutorLoadOut(_CamelModel):
    norm_hours: float
    size_class: str | None = None
    rows: list[ExecutorLoadRowOut]
    hints: list[RebalanceHintOut]
    note: str


class OverloadCheckOut(_CamelModel):
    owner: str
    hours_before: float
    hours_after: float
    norm_hours: float
    overloaded: bool
    message: str | None = None


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _is_open(p: Proposal) -> bool:
    return p.status in (STATUS_PENDING, STATUS_APPROVED) and p.execution != EXECUTION_DONE


def _overdue(p: Proposal, now: datetime) -> bool:
    return p.status == STATUS_APPROVED and p.due_on is not None and p.due_on < now


async def norm_hours(db: AsyncSession) -> tuple[float, str | None]:
    """Норма часов на исполнителя по размеру предприятия (УК-22, УК-33)."""
    from app.modules.econ import config_value, get_enterprise_profile  # отложенно: econ тянет governance

    profile = await get_enterprise_profile(db)
    by_size = await config_value(db, "executor_load_norm_hours", {}) or {}
    value = by_size.get(profile.size_class or "", by_size.get("default", DEFAULT_NORM_HOURS))
    return float(value or DEFAULT_NORM_HOURS), profile.size_class


def explain_weight(characteristic: str | None, char_w: float, criticality: str | None, crit_w: float,
                   hours: float | None) -> tuple[float | None, str]:
    """(вес, объяснение) меры — УК-31."""
    w = measure_weight(char_w, crit_w, hours)
    char_part = f"«{characteristic or 'характеристика не указана'}» (вес {char_w:g})"
    crit_part = f"{criticality or 'критичность не указана'} (×{crit_w:g})"
    if w is None:
        return None, f"{char_part} × {crit_part} × часы не оценены — вес появится после оценки часов"
    return w, f"{char_part} × {crit_part} × {hours:g} ч = {w:g}"


async def _measures_by_owner(db: AsyncSession) -> dict[str, list[LoadMeasureOut]]:
    now = _now()
    crit_by_name = {
        name: (cls.value if cls is not None else None)
        for name, cls in (await db.execute(select(System.name, System.criticality_class))).all()
    }
    props = list((await db.execute(
        select(Proposal).where(
            Proposal.status.in_((STATUS_PENDING, STATUS_APPROVED)),
            or_(Proposal.execution.is_(None), Proposal.execution != EXECUTION_DONE),
        )
    )).scalars().all())
    out: dict[str, list[LoadMeasureOut]] = defaultdict(list)
    for p in props:
        owner = (p.owner or "").strip()
        if not owner or not _is_open(p):
            continue
        canon = canonical_characteristic(p.characteristic or "")
        char_w = CHARACTERISTIC_WEIGHTS.get(canon, 1.0)   # неизвестная — нейтральный вес, не 0
        crit = crit_by_name.get(p.system_name)
        crit_w = DEFAULT_CRITICALITY_WEIGHTS.get(crit or "", 1.0)
        hours = float(p.effort_hours) if p.effort_hours is not None else None
        weight, explained = explain_weight(canon or p.characteristic, char_w, crit, crit_w, hours)
        out[owner].append(LoadMeasureOut(
            proposal_id=p.id, title=p.risk_title or p.metric_name or p.system_name,
            system=p.system_name, characteristic=p.characteristic, criticality=crit,
            hours=hours, weight=weight, weight_explained=explained,
            overdue=_overdue(p, now), due_on=p.due_on,
        ))
    return out


def _state(hours: float, overdue: int, norm: float) -> str:
    if hours > norm:
        return STATE_OVERLOADED
    if hours < norm * FREE_SHARE and overdue == 0:
        return STATE_FREE
    return STATE_NORMAL


def _row(owner: str, measures: list[LoadMeasureOut], norm: float) -> ExecutorLoadRowOut:
    hours = sum(m.hours or 0 for m in measures)
    overdue = sum(m.overdue for m in measures)
    return ExecutorLoadRowOut(
        owner=owner, open_measures=len(measures), hours=round(hours, 2),
        weighted_load=round(sum(m.weight or 0 for m in measures), 2),
        without_estimate=sum(m.hours is None for m in measures), overdue=overdue,
        on_critical_systems=sum(m.criticality == "MISSION CRITICAL" for m in measures),
        norm_hours=norm, load_pct=round(hours / norm * 100, 1) if norm else 0.0,
        state=_state(hours, overdue, norm),
        measures=sorted(measures, key=lambda m: m.weight or 0, reverse=True),
    )


def rebalance_hints(rows: list[ExecutorLoadRowOut]) -> list[RebalanceHintOut]:
    """Жадная рекомендация (УК-33): перегруженному — передать непросроченные оценённые меры тем,
    у кого запас по норме больше всего. На каждом шаге выбирается НАИМЕНЬШАЯ мера, которая
    одна закрывает превышение (минимум потрясений для исполнителя), а если такой нет — самая
    крупная. Просроченные не предлагаются: их передача прячет просрочку за новым исполнителем.
    Рекомендация, не действие."""
    spare = {r.owner: r.norm_hours - r.hours for r in rows if r.state == STATE_FREE}
    hints: list[RebalanceHintOut] = []
    for r in sorted(rows, key=lambda x: x.hours - x.norm_hours, reverse=True):
        if r.state != STATE_OVERLOADED:
            continue
        excess = r.hours - r.norm_hours
        movable = [m for m in r.measures if m.hours and not m.overdue]
        while excess > 0 and movable:
            covering = sorted((m for m in movable if (m.hours or 0) >= excess), key=lambda m: m.hours or 0)
            ordered = covering + sorted((m for m in movable if (m.hours or 0) < excess),
                                        key=lambda m: m.hours or 0, reverse=True)
            m, receiver = next(
                ((m, max(((o, s) for o, s in spare.items() if s >= (m.hours or 0) and o != r.owner),
                         key=lambda x: x[1], default=None)) for m in ordered),
                (None, None),
            )
            movable = [x for x in movable if x is not m]
            if m is None or receiver is None:
                continue
            to, _ = receiver
            spare[to] -= m.hours or 0
            excess -= m.hours or 0
            hints.append(RebalanceHintOut(
                proposal_id=m.proposal_id, title=m.title, from_owner=r.owner, to_owner=to,
                hours=m.hours or 0,
                reason=(f"{r.owner}: {r.hours:g} ч при норме {r.norm_hours:g}; у {to} свободно "
                        f"{spare[to] + (m.hours or 0):g} ч"),
            ))
    return hints


async def executor_load(db: AsyncSession) -> ExecutorLoadOut:
    norm, size_class = await norm_hours(db)
    by_owner = await _measures_by_owner(db)
    # Исполнители без открытых мер — тоже кандидаты «свободен» (роль EXECUTOR в системе).
    for full_name, username in (await db.execute(
        select(User.full_name, User.username).where(User.is_active.is_(True), User.role == EXECUTOR_ROLE)
    )).all():
        by_owner.setdefault((full_name or username).strip(), [])
    rows = sorted((_row(o, ms, norm) for o, ms in by_owner.items()),
                  key=lambda r: (r.hours, r.weighted_load), reverse=True)
    without = sum(r.without_estimate for r in rows)
    note = (f"Норма — {norm:g} ч открытых мер на исполнителя"
            + (f" (размер предприятия: {size_class})" if size_class else "")
            + ". Сравнение исполнителей — по весу мер (характеристика × критичность × часы).")
    if without:
        note += f" Мер без оценки часов: {without} — в часы и вес не входят, показаны отдельно."
    return ExecutorLoadOut(norm_hours=norm, size_class=size_class, rows=rows,
                           hints=rebalance_hints(rows), note=note)


async def overload_check(db: AsyncSession, owner: str, extra_hours: float | None,
                         exclude_proposal_id: uuid.UUID | None = None) -> OverloadCheckOut:
    """Предупреждение при назначении меры (УК-33): станет ли исполнитель перегружен."""
    norm, _ = await norm_hours(db)
    measures = (await _measures_by_owner(db)).get(owner.strip(), [])
    before = sum(m.hours or 0 for m in measures if m.proposal_id != exclude_proposal_id)
    after = before + (extra_hours or 0)
    overloaded = after > norm
    message = (f"{owner}: после назначения {after:g} ч открытых мер при норме {norm:g} ч — "
               f"исполнитель перегружен" if overloaded else None)
    return OverloadCheckOut(owner=owner, hours_before=round(before, 2), hours_after=round(after, 2),
                            norm_hours=norm, overloaded=overloaded, message=message)
