"""
Агрегация дашборда стоимости (BL-007, §5 ТЗ, RE-16) — материал для CTO/CEO.

«Одна цифра, которую CEO уносит с совещания» (портфельный ALE) + тепловая карта концентрации риска,
топ рисков, воронка замкнутости, накопленная деградация. Только ЧТЕНИЕ/агрегация.

Импортирует МОДЕЛИ соседних доменов напрямую (как seed_demo) — не фасады, чтобы не тянуть их
сервисы и гарантированно не создать цикл с econ (econ — нижний слой). Модели не импортируют econ.
"""
from __future__ import annotations

from collections import defaultdict

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.econ.schemas import (
    CostDashboardOut,
    HeatCellOut,
    SystemAleOut,
    TopRiskOut,
    VerdictBreakdownOut,
)
from app.modules.incidents.models import INCIDENT_DEGRADATION, TechIncident
from app.modules.nonconformity.models import STATUS_VERIFIED, Nonconformity
from app.modules.risk.models import RISK_EVENT_ACTIVE, RiskEvent, RiskEventSubchar
from app.modules.systems.models import System

UNASSIGNED = "Портфель (без ИС)"


async def cost_dashboard(db: AsyncSession) -> CostDashboardOut:
    events = list((await db.execute(
        select(RiskEvent).where(RiskEvent.status == RISK_EVENT_ACTIVE)
    )).scalars().all())
    subchars = list((await db.execute(select(RiskEventSubchar))).scalars().all())
    systems = {s.id: s.name for s in (await db.execute(select(System))).scalars().all()}
    ncs = list((await db.execute(select(Nonconformity))).scalars().all())
    incidents = list((await db.execute(select(TechIncident))).scalars().all())

    def ale(e: RiskEvent) -> float:
        return float(e.ale_avg or 0)

    portfolio_ale = round(sum(ale(e) for e in events), 2)

    # Топ-10 рисков по ALE (со столбцом «владелец» — самый действенный элемент, §5).
    top_risks = [
        TopRiskOut(code=e.code, title=e.title, owner=e.owner, system=systems.get(e.system_id),
                   ale_avg=round(ale(e), 2), regulatory=bool(e.regulatory))
        for e in sorted(events, key=ale, reverse=True)[:10]
    ]

    # ALE по ИС.
    by_sys: dict[str, float] = defaultdict(float)
    for e in events:
        by_sys[systems.get(e.system_id) or UNASSIGNED] += ale(e)
    by_system = [SystemAleOut(system=k, ale=round(v, 2))
                 for k, v in sorted(by_sys.items(), key=lambda kv: kv[1], reverse=True)]

    # Тепловая карта ИС × подхарактеристика: ALE события распределяется по его подхарактеристикам.
    sc_by_event: dict = defaultdict(list)
    for sc in subchars:
        sc_by_event[sc.risk_event_id].append(sc)
    heat: dict[tuple[str, str], float] = defaultdict(float)
    for e in events:
        links = sc_by_event.get(e.id, [])
        if not links:
            continue
        share = ale(e) / len(links)
        sysname = systems.get(e.system_id) or UNASSIGNED
        for sc in links:
            heat[(sysname, sc.subcharacteristic)] += share
    heatmap = [HeatCellOut(system=s, subcharacteristic=sub, ale=round(v, 2))
               for (s, sub), v in sorted(heat.items(), key=lambda kv: kv[1], reverse=True)]

    # Несоответствия: воронка + вердикты (устранено/компенсировано/принято) + блокирующие.
    total = len(ncs)
    verified = sum(1 for nc in ncs if nc.status == STATUS_VERIFIED)
    closure_rate = round(verified / total * 100, 1) if total else 0.0
    verdicts: dict[str, int] = defaultdict(int)
    for nc in ncs:
        if nc.decision_verdict:
            verdicts[nc.decision_verdict] += 1
    blocking = sum(1 for nc in ncs if nc.is_blocking and nc.status != STATUS_VERIFIED)

    # Накопленная деградация (сумма C_ТС по сбоям типа «деградация») — обычно самая неожиданная цифра.
    degradation_total = round(
        sum(float(i.cost_total or 0) for i in incidents if i.incident_type == INCIDENT_DEGRADATION), 2,
    )

    return CostDashboardOut(
        portfolio_ale=portfolio_ale,
        risks_count=len(events),
        degradation_total=degradation_total,
        nonconformities_total=total,
        verified=verified,
        closure_rate=closure_rate,
        blocking_count=blocking,
        verdict=VerdictBreakdownOut(
            eliminate=verdicts.get("ELIMINATE", 0),
            compensate=verdicts.get("COMPENSATE", 0),
            accept=verdicts.get("ACCEPT", 0),
        ),
        top_risks=top_risks,
        by_system=by_system,
        heatmap=heatmap,
    )
