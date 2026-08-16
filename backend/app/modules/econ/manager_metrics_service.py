"""
Метрики эффективности руководителей (BL-007, задача 12 / §7.1 ТЗ) — ДИАГНОСТИЧЕСКИЙ режим.

По каждому владельцу — нагрузка, просроченность, выполнено, средний возраст открытых, ΔALE под
управлением, доля принятия риска, доля компенсирующих мер. Считается по несоответствиям (nonconformity)
и мерам (governance.Proposal) вместе.

РЕЖИМ ДИАГНОСТИКА (решение заказчика): метрики НЕ привязаны к мотивации. Это важно — §7.2: при прямой
привязке к премии любая метрика ломается (дробление мер, срок с запасом, завышение исходного ALE).
Первые 2 квартала — только наблюдение и калибровка порогов. Антигейм-механики (фиксация до-меры ALE,
вес по критичности, вывод пакетом) включаются позже, если появится привязка к мотивации.

Самодостаточный модуль: читает МОДЕЛИ nonconformity/governance напрямую (как dashboard_service),
econ остаётся нижним слоем; в роутер монтируется отдельным эндпойнтом.

ТЗ v19 п.13 (В-41): «взвешенная нагрузка» — экран загрузки/балансировки. Считается ТОЛЬКО по мерам
(у несоответствий нет часов/трудоёмкости) через quality.measure_weight (характеристика × критичность
ИС × часы). Меры без оценки часов — отдельный счётчик measuresWithoutEstimate, НЕ ноль молча: иначе
исполнитель с 10 неоценёнными мерами выглядел бы «свободным» рядом с тем, у кого 2 оценённые.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.governance.models import (
    EXECUTION_DONE,
    MEASURE_COMPENSATING,
    STATUS_APPROVED,
    STATUS_PENDING,
    Proposal,
)
from app.modules.nonconformity.models import STATUS_EVALUATED, STATUS_VERIFIED, Nonconformity
from app.modules.quality import (
    CHARACTERISTIC_WEIGHTS,
    DEFAULT_CRITICALITY_WEIGHTS,
    canonical_characteristic,
    measure_weight,
)
from app.modules.systems import System


class _CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)


class ManagerMetricRow(_CamelModel):
    owner: str
    open_count: int              # нагрузка: открытые несоответствия + меры
    overdue_count: int           # просроченность: нарушен SLA/срок
    completed_count: int         # доведено до «Верифицировано»/«Исполнено»
    avg_age_days: float | None   # средний возраст открытых (застревание)
    delta_ale_managed: float     # ₽ риска под управлением (оценённый/снятый)
    accept_share: float          # % решений «принять» (склонность прятать проблему)
    compensating_share: float    # % компенсирующих мер (лечение симптомов)
    # ТЗ v19 п.13 (В-41): взвешенная нагрузка по открытым мерам — экран загрузки/балансировки.
    weighted_load: float             # Σ measure_weight(характеристика × критичность × часы)
    hours_estimated: float           # Σ effort_hours (только по мерам с оценкой)
    measures_with_estimate: int      # открытых мер с проставленными часами
    measures_without_estimate: int   # открытых мер БЕЗ оценки часов — не ноль молча (В-41)


class ManagerMetricsOut(_CamelModel):
    mode: str                    # 'diagnostic' — без привязки к мотивации (§7.2)
    note: str
    generated_at: datetime
    rows: list[ManagerMetricRow]


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _age_days(created: datetime | None, now: datetime) -> float | None:
    if created is None:
        return None
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    return max(0.0, (now - created).total_seconds() / 86400.0)


def _due_overdue(due_date: str | None, now: datetime) -> bool:
    """proposals.due_date — ISO-строка; просрочен, если дата в прошлом."""
    if not due_date:
        return False
    try:
        d = datetime.fromisoformat(due_date)
    except ValueError:
        try:
            d = datetime.strptime(due_date[:10], "%Y-%m-%d")
        except ValueError:
            return False
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d < now


async def manager_metrics(db: AsyncSession) -> ManagerMetricsOut:
    now = _now()
    ncs = list((await db.execute(select(Nonconformity))).scalars().all())
    props = list((await db.execute(select(Proposal))).scalars().all())
    # System.system_id на Proposal не заполняется (ProposalCreate принимает только system_name,
    # см. governance/schemas.py) — критичность резолвим по имени, как event_service.cell_detail.
    crit_by_system_name: dict[str, str] = {
        name: cls.value
        for name, cls in (await db.execute(select(System.name, System.criticality_class))).all()
    }

    # Аккумуляторы по владельцу.
    acc: dict[str, dict] = defaultdict(lambda: {
        "open": 0, "overdue": 0, "completed": 0, "ages": [], "delta_ale": 0.0,
        "decisions": 0, "accepts": 0, "measures": 0, "compensating": 0,
        "weighted_load": 0.0, "hours": 0.0, "with_estimate": 0, "without_estimate": 0,
    })

    for nc in ncs:
        owner = (nc.owner or "").strip()
        if not owner:
            continue
        a = acc[owner]
        if nc.status == STATUS_VERIFIED:
            a["completed"] += 1
            a["delta_ale"] += float(nc.evaluated_ale or 0)   # снятый под управлением риск
        else:
            a["open"] += 1
            age = _age_days(nc.created_at, now)
            if age is not None:
                a["ages"].append(age)
        # Просрочка решения: >SLA в «Оценено» без решения (§3.3).
        if nc.status == STATUS_EVALUATED and nc.sla_due is not None:
            sla = nc.sla_due if nc.sla_due.tzinfo else nc.sla_due.replace(tzinfo=timezone.utc)
            if sla < now:
                a["overdue"] += 1
        if nc.decision_verdict:
            a["decisions"] += 1
            if nc.decision_verdict == "ACCEPT":
                a["accepts"] += 1

    for p in props:
        owner = (p.owner or "").strip()
        if not owner:
            continue
        a = acc[owner]
        done = p.execution == EXECUTION_DONE
        is_open = p.status in (STATUS_PENDING, STATUS_APPROVED) and not done
        if done:
            a["completed"] += 1
            a["delta_ale"] += float(p.delta_ale_cash or 0)
        elif p.status in (STATUS_PENDING, STATUS_APPROVED):
            a["open"] += 1
            age = _age_days(p.created_at, now)
            if age is not None:
                a["ages"].append(age)
        if p.status == STATUS_APPROVED and not done and _due_overdue(p.due_date, now):
            a["overdue"] += 1
        if p.measure_type:
            a["measures"] += 1
            if p.measure_type == MEASURE_COMPENSATING:
                a["compensating"] += 1

        # Взвешенная нагрузка — только открытые меры (та же нагрузка, что "open"), только по
        # мерам (не по несоответствиям — у них нет часов). effort_hours=None не участвует в
        # weighted_load/hours (не 0) — считается отдельным счётчиком "без оценки" (В-41).
        if is_open:
            canon = canonical_characteristic(p.characteristic or "")
            char_w = CHARACTERISTIC_WEIGHTS.get(canon, 1.0)  # неизвестная характеристика — нейтральный вес, не 0
            crit_w = DEFAULT_CRITICALITY_WEIGHTS.get(crit_by_system_name.get(p.system_name, ""), 1.0)
            hours = float(p.effort_hours) if p.effort_hours is not None else None
            w = measure_weight(char_w, crit_w, hours)
            if w is None:
                a["without_estimate"] += 1
            else:
                a["weighted_load"] += w
                a["hours"] += hours
                a["with_estimate"] += 1

    rows: list[ManagerMetricRow] = []
    for owner, a in acc.items():
        ages = a["ages"]
        rows.append(ManagerMetricRow(
            owner=owner,
            open_count=a["open"],
            overdue_count=a["overdue"],
            completed_count=a["completed"],
            avg_age_days=round(sum(ages) / len(ages), 1) if ages else None,
            delta_ale_managed=round(a["delta_ale"], 2),
            accept_share=round(a["accepts"] / a["decisions"] * 100, 1) if a["decisions"] else 0.0,
            compensating_share=round(a["compensating"] / a["measures"] * 100, 1) if a["measures"] else 0.0,
            weighted_load=round(a["weighted_load"], 2),
            hours_estimated=round(a["hours"], 2),
            measures_with_estimate=a["with_estimate"],
            measures_without_estimate=a["without_estimate"],
        ))
    rows.sort(key=lambda r: (r.open_count, r.overdue_count), reverse=True)

    return ManagerMetricsOut(
        mode="diagnostic",
        note="Диагностика без привязки к мотивации (§7.2): метрики выводятся пакетом, не по одной. "
             "Первые 2 квартала — наблюдение и калибровка порогов.",
        generated_at=now,
        rows=rows,
    )
