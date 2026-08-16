"""
Логика рискового события (BL-007, RE-08/09): CRUD числового риска, графовые связи и пересчёт ALE.

RE-08: риск с числовым ARO, связи M:N (подхарактеристика / ТС / мера). RE-09: ALE = ARO × SLE по
привязанным реализациям (ТС) через экономический движок. Кросс-доменные зависимости — только через
фасады: incidents (реализации), governance (меры), econ (движок и C_ТС).
"""
from __future__ import annotations

import uuid
from collections import defaultdict

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.econ import annual_loss_expectancy, compute_incident_cost, config_value
from app.modules.governance import Proposal
from app.modules.incidents import TechIncident
from app.modules.risk.event_schemas import (
    AleResultOut,
    HeatmapCellDetailOut,
    HeatmapCellMeasureOut,
    HeatmapCellRiskOut,
    MeasureLinkIn,
    RiskEventCreate,
    RiskEventUpdate,
    SubcharLinkIn,
)
from app.modules.risk.models import (
    RISK_EVENT_ACTIVE,
    RISK_EVENT_ARCHIVED,
    RiskEvent,
    RiskEventIncident,
    RiskEventMeasure,
    RiskEventSubchar,
)
from app.modules.systems import System
from app.shared.exceptions import ConflictError, NotFoundError


# ═══════════════════════ CRUD ═══════════════════════

async def list_events(db: AsyncSession, *, status: str = "active", system_id: uuid.UUID | None = None,
                      category: str | None = None) -> list[RiskEvent]:
    stmt = select(RiskEvent)
    if status != "all":
        stmt = stmt.where(RiskEvent.status == status)
    if system_id is not None:
        stmt = stmt.where(RiskEvent.system_id == system_id)
    if category:
        stmt = stmt.where(RiskEvent.category == category)
    return list((await db.execute(stmt.order_by(RiskEvent.created_at.desc()))).scalars().all())


async def get_or_404(db: AsyncSession, event_id: uuid.UUID) -> RiskEvent:
    ev = await db.get(RiskEvent, event_id)
    if ev is None:
        raise NotFoundError("Рисковое событие не найдено")
    return ev


async def create_event(db: AsyncSession, data: RiskEventCreate, username: str | None) -> RiskEvent:
    dup = (await db.execute(select(RiskEvent).where(RiskEvent.code == data.code))).scalar_one_or_none()
    if dup is not None:
        raise ConflictError(f"Рисковое событие с кодом {data.code} уже существует")
    ev = RiskEvent(**data.model_dump(exclude_none=True), created_by=username)
    db.add(ev)
    await db.commit()
    await db.refresh(ev)
    return ev


async def update_event(db: AsyncSession, ev: RiskEvent, data: RiskEventUpdate) -> RiskEvent:
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(ev, field, value)
    await db.commit()
    await db.refresh(ev)
    return ev


async def archive_event(db: AsyncSession, ev: RiskEvent) -> RiskEvent:
    ev.status = RISK_EVENT_ARCHIVED
    await db.commit()
    await db.refresh(ev)
    return ev


# ═══════════════════════ Связи (M:N) ═══════════════════════

async def link_subchar(db: AsyncSession, event_id: uuid.UUID, data: SubcharLinkIn) -> RiskEventSubchar:
    await get_or_404(db, event_id)
    dup = (await db.execute(select(RiskEventSubchar).where(
        RiskEventSubchar.risk_event_id == event_id,
        RiskEventSubchar.characteristic == data.characteristic,
        RiskEventSubchar.subcharacteristic == data.subcharacteristic,
    ))).scalar_one_or_none()
    if dup is not None:
        raise ConflictError("Подхарактеристика уже связана с этим риском")
    link = RiskEventSubchar(risk_event_id=event_id, characteristic=data.characteristic,
                            subcharacteristic=data.subcharacteristic)
    db.add(link)
    await db.commit()
    await db.refresh(link)
    return link


async def link_incident(db: AsyncSession, event_id: uuid.UUID, incident_id: uuid.UUID) -> RiskEventIncident:
    await get_or_404(db, event_id)
    if await db.get(TechIncident, incident_id) is None:
        raise NotFoundError("Технический сбой не найден")
    dup = (await db.execute(select(RiskEventIncident).where(
        RiskEventIncident.risk_event_id == event_id,
        RiskEventIncident.incident_id == incident_id,
    ))).scalar_one_or_none()
    if dup is not None:
        raise ConflictError("Этот техсбой уже привязан к риску")
    link = RiskEventIncident(risk_event_id=event_id, incident_id=incident_id)
    db.add(link)
    await db.commit()
    await db.refresh(link)
    return link


async def link_measure(db: AsyncSession, event_id: uuid.UUID, data: MeasureLinkIn) -> RiskEventMeasure:
    await get_or_404(db, event_id)
    if await db.get(Proposal, data.proposal_id) is None:
        raise NotFoundError("Мера (proposal) не найдена")
    dup = (await db.execute(select(RiskEventMeasure).where(
        RiskEventMeasure.risk_event_id == event_id,
        RiskEventMeasure.proposal_id == data.proposal_id,
    ))).scalar_one_or_none()
    if dup is not None:
        raise ConflictError("Эта мера уже привязана к риску")
    link = RiskEventMeasure(risk_event_id=event_id, proposal_id=data.proposal_id,
                            ale_reduction_share=data.ale_reduction_share)
    db.add(link)
    await db.commit()
    await db.refresh(link)
    return link


async def linked_incidents(db: AsyncSession, event_id: uuid.UUID) -> list[TechIncident]:
    ids = (await db.execute(select(RiskEventIncident.incident_id).where(
        RiskEventIncident.risk_event_id == event_id,
    ))).scalars().all()
    if not ids:
        return []
    return list((await db.execute(select(TechIncident).where(TechIncident.id.in_(ids)))).scalars().all())


# ═══════════════════════ Пересчёт ALE (RE-09) ═══════════════════════

def _percentile(values: list[float], p: float) -> float | None:
    """Линейно-интерполированный перцентиль выборки (для ALE_P90)."""
    if not values:
        return None
    s = sorted(values)
    if len(s) == 1:
        return s[0]
    k = (len(s) - 1) * p / 100.0
    lo = int(k)
    hi = min(lo + 1, len(s) - 1)
    return round(s[lo] + (s[hi] - s[lo]) * (k - lo), 2)


async def recompute_ale(db: AsyncSession, ev: RiskEvent) -> AleResultOut:
    """ALE = ARO × SLE по привязанным реализациям (§2.3). SLE — средний C_ТС; ARO — по числу ТС за
    окно ITSM (или экспертный, если задан). Считаем три величины: средний / P90 / MaxSLE — иначе
    Mission Critical систематически недооценивается."""
    incidents = await linked_incidents(db, ev.id)

    # Стоимость каждой реализации (C_ТС): из кэша incident.cost_total либо считаем движком.
    costs: list[float] = []
    for inc in incidents:
        value = inc.cost_total
        if value is None:
            value = await compute_incident_cost(db, inc)  # выставит inc.cost_total
        if value is not None and float(value) > 0:
            costs.append(float(value))

    # ARO: экспертный (если задан) либо частота = число ТС / окно наблюдения (мес истории ITSM).
    if ev.aro_is_expert and ev.aro is not None:
        aro: float | None = float(ev.aro)
    else:
        window_months = float(await config_value(db, "itsm_history_months", 12) or 12)
        window_years = max(window_months / 12.0, 1e-9)
        aro = round(len(incidents) / window_years, 4)

    # SLE: средний C_ТС по реализациям, иначе экспертная оценка риска.
    if costs:
        sle_avg = round(sum(costs) / len(costs), 2)
        max_sle = max(costs)
        sle_p90 = _percentile(costs, 90) if len(costs) >= 3 else None
    else:
        sle_avg = float(ev.sle_expert) if ev.sle_expert is not None else 0.0
        max_sle = float(ev.sle_expert) if ev.sle_expert is not None else None
        sle_p90 = None

    result = annual_loss_expectancy(aro or 0.0, sle_avg, sle_p90, max_sle)
    ev.ale_avg = result.ale_avg
    ev.ale_p90 = result.ale_p90
    ev.max_sle = result.max_sle
    if not ev.aro_is_expert:
        ev.aro = aro
    await db.commit()
    await db.refresh(ev)

    return AleResultOut(
        risk_event_id=ev.id, aro=aro, incidents_counted=len(incidents), incidents_costed=len(costs),
        ale_avg=result.ale_avg, ale_p90=result.ale_p90, max_sle=result.max_sle,
    )


# ═══════════════════ Ячейка теплокарты: риски × меры × деньги (ТЗ v19 п.4) ═══════════════════

async def cell_detail(db: AsyncSession, system_name: str, characteristic: str) -> HeatmapCellDetailOut:
    """Риски этой ИС, привязанные к этой характеристике (через RiskEventSubchar), с их деньгами
    (ALE) и привязанными мерами. system_name, не system_id: управленческий дашборд (источник
    клика по ячейке) в LIVE-режиме работает именами ИС — ExecutiveDashboard.tsx строит свои данные
    из /reports/executive-dashboard, где есть только yAxisLabels (имена), настоящий system_id туда
    не прокидывается. Система не найдена / рисков нет → пустой список, не ошибка (карточка ИС
    показывает «риски не заведены», это нормальное состояние на пилоте, не сбой)."""
    system = (await db.execute(select(System).where(System.name == system_name))).scalar_one_or_none()
    if system is None:
        return HeatmapCellDetailOut(system_name=system_name, characteristic=characteristic, total_ale=0.0, risks=[])

    rows = (await db.execute(
        select(RiskEvent, RiskEventSubchar.subcharacteristic)
        .join(RiskEventSubchar, RiskEventSubchar.risk_event_id == RiskEvent.id)
        .where(
            RiskEvent.system_id == system.id,
            RiskEvent.status == RISK_EVENT_ACTIVE,
            RiskEventSubchar.characteristic == characteristic,
        )
    )).all()

    risks_by_id: dict[uuid.UUID, RiskEvent] = {}
    subchars_by_risk: dict[uuid.UUID, set[str]] = defaultdict(set)
    for ev, subchar in rows:
        risks_by_id[ev.id] = ev
        subchars_by_risk[ev.id].add(subchar)

    measures_by_risk: dict[uuid.UUID, list[HeatmapCellMeasureOut]] = defaultdict(list)
    if risks_by_id:
        m_rows = (await db.execute(
            select(RiskEventMeasure, Proposal)
            .join(Proposal, Proposal.id == RiskEventMeasure.proposal_id)
            .where(RiskEventMeasure.risk_event_id.in_(risks_by_id.keys()))
        )).all()
        for link, proposal in m_rows:
            measures_by_risk[link.risk_event_id].append(HeatmapCellMeasureOut(
                proposal_id=proposal.id,
                title=proposal.risk_title or proposal.metric_name or "Мера",
                status=proposal.status,
                ale_reduction_share=float(link.ale_reduction_share) if link.ale_reduction_share is not None else None,
                rosi=float(proposal.rosi) if proposal.rosi is not None else None,
                verdict=proposal.verdict,
            ))

    risks_out = [
        HeatmapCellRiskOut(
            id=ev.id, code=ev.code, title=ev.title,
            ale_avg=float(ev.ale_avg) if ev.ale_avg is not None else None,
            ale_p90=float(ev.ale_p90) if ev.ale_p90 is not None else None,
            status=ev.status,
            subcharacteristics=sorted(subchars_by_risk[ev.id]),
            measures=measures_by_risk.get(ev.id, []),
        )
        for ev in risks_by_id.values()
    ]
    risks_out.sort(key=lambda r: r.ale_avg or 0, reverse=True)
    total_ale = round(sum(r.ale_avg or 0 for r in risks_out), 2)

    return HeatmapCellDetailOut(
        system_name=system.name, characteristic=characteristic, total_ale=total_ale, risks=risks_out,
    )
