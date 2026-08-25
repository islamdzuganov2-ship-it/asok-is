"""
Очередь решений по матрице акцепта (ТЗ v21, КП-11) — материал для кокпита CEO.

Слайд 4 обещает матрицу акцепта («до 1 млн — владелец ИС, 1–10 млн — CIO, свыше — правление»),
но `acceptance_matrix` (econ_config) сегодня используется только один раз — при фиксации решения
`ACCEPT` по несоответствию (nonconformity/service.decide), как ЗАПИСЬ, а не как очередь. Этот
модуль строит очередь: несоответствия в статусе EVALUATED (ALE посчитан, решения ещё нет) —
то есть именно то, что ждёт решения и подписи требуемого уровня.

Читает соседние домены через их публичные фасады (`__init__.py`), не через `.models` —
econ остаётся нижним слоем, nonconformity/service импортирует econ, а не наоборот.
"""
from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.econ.schemas import (
    AcceptanceMatrixEntryOut,
    AcceptanceQueueItemOut,
    AcceptanceQueueOut,
    AcceptanceQueueSignerStatOut,
)
from app.modules.econ.service import config_value
from app.modules.nonconformity import LEVEL_CRITICAL, STATUS_EVALUATED, Nonconformity
from app.modules.risk import RiskEvent
from app.modules.systems import System

UNSIGNED = "не определён"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _signer_for(matrix: list[dict], ale: float) -> str | None:
    for entry in matrix:
        cap = entry.get("max_ale")
        if cap is None or ale <= float(cap):
            return entry.get("signer")
    return None


def _evaluated_since(nc: Nonconformity) -> datetime:
    """Момент перехода в «Оценено» — из истории (аудит), иначе создание карточки."""
    for h in reversed(nc.history or []):
        if h.get("action") == "evaluate":
            try:
                ts = datetime.fromisoformat(h["at"])
                return ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)
            except (ValueError, KeyError):
                break
    created = nc.created_at
    return created if created.tzinfo else created.replace(tzinfo=timezone.utc)


async def acceptance_queue(
    db: AsyncSession, *,
    signer: str | None = None,
    system_id: uuid.UUID | None = None,
    criticality: str | None = None,
) -> AcceptanceQueueOut:
    matrix = await config_value(db, "acceptance_matrix", []) or []
    catastrophe_threshold = await config_value(db, "catastrophe_threshold", None)
    sla_days_default = int(await config_value(db, "nc_sla_days", 30) or 30)
    sla_days_critical = int(await config_value(db, "nc_sla_days_critical", 3) or 3)

    stmt = select(Nonconformity).where(Nonconformity.status == STATUS_EVALUATED)
    if system_id is not None:
        stmt = stmt.where(Nonconformity.system_id == system_id)
    ncs = list((await db.execute(stmt)).scalars().all())

    systems = {s.id: s for s in (await db.execute(select(System))).scalars().all()}
    risk_ids = [nc.risk_event_id for nc in ncs if nc.risk_event_id]
    events: dict[uuid.UUID, RiskEvent] = {}
    if risk_ids:
        events = {
            e.id: e for e in
            (await db.execute(select(RiskEvent).where(RiskEvent.id.in_(risk_ids)))).scalars().all()
        }

    now = _now()
    items: list[AcceptanceQueueItemOut] = []
    for nc in ncs:
        ale = float(nc.evaluated_ale or 0)
        sg = _signer_for(matrix, ale)
        if signer is not None and (sg or UNSIGNED) != signer:
            continue
        sysobj = systems.get(nc.system_id) if nc.system_id else None
        crit = sysobj.criticality_class.value if sysobj else None
        if criticality is not None and crit != criticality:
            continue

        waiting_days = max(0, (now - _evaluated_since(nc)).days)
        sla_days = sla_days_critical if nc.level == LEVEL_CRITICAL else sla_days_default
        overdue = bool(nc.sla_due and nc.sla_due < now)

        ev = events.get(nc.risk_event_id) if nc.risk_event_id else None
        vetoes: list[str] = []
        if ev and ev.regulatory:
            vetoes.append("regulatory")
        if ev and ev.max_sle is not None and catastrophe_threshold:
            if float(ev.max_sle) > float(catastrophe_threshold):
                vetoes.append("catastrophe")

        items.append(AcceptanceQueueItemOut(
            kind="NONCONFORMITY",
            id=nc.id,
            title=nc.description or f"{nc.characteristic} — {nc.subcharacteristic}",
            system_name=nc.system_name,
            criticality=crit,
            ale=round(ale, 2),
            signer=sg,
            waiting_days=waiting_days,
            sla_days=sla_days,
            overdue=overdue,
            vetoes=vetoes,
        ))

    items.sort(key=lambda i: i.ale, reverse=True)

    by_signer_acc: dict[str, dict[str, float]] = defaultdict(lambda: {"count": 0, "total_ale": 0.0, "overdue": 0})
    for it in items:
        key = it.signer or UNSIGNED
        row = by_signer_acc[key]
        row["count"] += 1
        row["total_ale"] += it.ale
        if it.overdue:
            row["overdue"] += 1
    by_signer = [
        AcceptanceQueueSignerStatOut(
            signer=k, count=int(v["count"]), total_ale=round(v["total_ale"], 2), overdue=int(v["overdue"]),
        )
        for k, v in by_signer_acc.items()
    ]

    matrix_applied = [
        AcceptanceMatrixEntryOut(max_ale=e.get("max_ale"), signer=e.get("signer", "—"))
        for e in matrix
    ]

    return AcceptanceQueueOut(items=items, by_signer=by_signer, matrix_applied=matrix_applied)
