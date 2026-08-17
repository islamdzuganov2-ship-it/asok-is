"""
Экономика меры (BL-007, RE-11/12/13): ROSI и рекомендованный вердикт для Proposal.

ВЫНЕСЕНО из governance.service намеренно: тянет фасады econ (движок) и risk (привязанные рисковые
события) — держим эти зависимости в подмодуле, который импортирует только роутер, чтобы фасад
governance оставался лёгким и без циклов с risk (risk.event_service, в свою очередь, тянет governance).

Эффект меры считается по ПОРТФЕЛЮ снимаемых рисков (§1.2): ΔALE = Σ ALE привязанных рисков × доля
снятия. Иначе любая инфраструктурная мера, снимающая класс рисков, провалит ROSI поодиночке.
"""
from __future__ import annotations

import math
from datetime import date as date_cls, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.econ import (
    DecisionInput,
    config_value,
    decide,
    measure_ale_risk,
    price_of_inaction_compensating,
    price_of_inaction_eliminating,
    requires_escalation,
    rosi,
)
from app.modules.governance.models import MEASURE_COMPENSATING, MEASURE_TYPES, VERDICTS, Proposal
from app.modules.governance.schemas import MeasureEconomicsIn, MeasureEconomicsResult, PriceOfInactionOut
from app.modules.incidents import TechIncident
from app.modules.risk import RiskEvent, RiskEventIncident, RiskEventMeasure
from app.modules.systems import System
from app.shared.exceptions import ValidationError


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def set_measure_economics(db: AsyncSession, p: Proposal, data: MeasureEconomicsIn) -> Proposal:
    """Ввод экономических параметров меры (CAPEX/OPEX/лаг/ΔScore/тип/вердикт). Расчёт — отдельно."""
    patch = data.model_dump(exclude_unset=True)
    if patch.get("measure_type") and patch["measure_type"] not in MEASURE_TYPES:
        raise ValidationError(f"Недопустимый тип меры: {patch['measure_type']}")
    if patch.get("verdict") and patch["verdict"] not in VERDICTS:
        raise ValidationError(f"Недопустимый вердикт: {patch['verdict']}")
    for field, value in patch.items():
        setattr(p, field, value)
    await db.commit()
    await db.refresh(p)
    return p


async def _linked_risks(db: AsyncSession, proposal_id) -> list[tuple[RiskEvent, float]]:
    """Привязанные рисковые события и доля снятия ALE каждой (RiskEventMeasure)."""
    links = list((await db.execute(
        select(RiskEventMeasure).where(RiskEventMeasure.proposal_id == proposal_id)
    )).scalars().all())
    if not links:
        return []
    shares = {l.risk_event_id: (float(l.ale_reduction_share) if l.ale_reduction_share is not None else 1.0)
              for l in links}
    risks = list((await db.execute(
        select(RiskEvent).where(RiskEvent.id.in_(list(shares.keys())))
    )).scalars().all())
    return [(r, shares.get(r.id, 1.0)) for r in risks]


async def recompute_economics(db: AsyncSession, p: Proposal) -> MeasureEconomicsResult:
    """ROSI (§3.1) + вердикт с вето (§3.2). ΔALE — по портфелю снимаемых рисков либо ручной ввод."""
    risks = await _linked_risks(db, p.id)

    # ΔALE/год: ручной ввод (кассовая часть) имеет приоритет; иначе — сумма по привязанным рискам.
    computed_delta = sum(float(r.ale_avg) * share for r, share in risks if r.ale_avg is not None)
    if p.delta_ale_cash is not None:
        delta_ale = float(p.delta_ale_cash)
    else:
        delta_ale = round(computed_delta, 2)
        p.delta_ale_cash = delta_ale

    # Вето-входы по портфелю рисков.
    regulatory = any(bool(r.regulatory) for r, _ in risks)
    max_sle_vals = [float(r.max_sle) for r, _ in risks if r.max_sle is not None]
    max_sle = max(max_sle_vals) if max_sle_vals else None
    ale_portfolio = sum(float(r.ale_avg) for r, _ in risks if r.ale_avg is not None)
    appetites = [float(r.risk_appetite) for r, _ in risks if r.risk_appetite is not None]
    appetite = min(appetites) if appetites else None
    threshold_raw = await config_value(db, "catastrophe_threshold", None)
    threshold = float(threshold_raw) if threshold_raw is not None else None

    # ROSI — только при наличии стоимости меры (иначе «бесплатная» мера даёт inf, не храним).
    capex = float(p.capex or 0)
    opex = float(p.opex_per_year or 0)
    impl = float(p.implementation_months or 0)
    rosi_res = None
    rosi_value = None
    if capex > 0 or opex > 0:
        horizon = int(await config_value(db, "rosi_horizon_months", 24) or 24)
        r_annual = float(await config_value(db, "discount_rate_annual", 0.20) or 0.20)
        rosi_res = rosi(capex, opex, delta_ale, impl, horizon, r_annual)
        rosi_value = rosi_res.rosi if math.isfinite(rosi_res.rosi) else None

    decision = decide(DecisionInput(
        rosi=rosi_value, ale=ale_portfolio, risk_appetite=appetite,
        regulatory=regulatory, max_sle=max_sle, catastrophe_threshold=threshold,
    ))

    p.rosi = rosi_value
    p.recommended_verdict = decision.verdict
    await db.commit()
    await db.refresh(p)

    return MeasureEconomicsResult(
        proposal_id=p.id, risks_count=len(risks), delta_ale_per_year=delta_ale,
        rosi=rosi_value, benefit_pv=(rosi_res.benefit_pv if rosi_res else None),
        cost_pv=(rosi_res.cost_pv if rosi_res else None),
        recommended_verdict=decision.verdict, reasons=decision.reasons,
    )


# ─────────────────────────────────────────────────────────────────────────────
# §17.2 (УК-42/43/44) — маршрутизация мер по критичности
# ─────────────────────────────────────────────────────────────────────────────

async def has_linked_risks(db: AsyncSession, proposal_id) -> bool:
    """§17.2 (УК-42): есть ли хотя бы одно связанное рисковое событие у меры."""
    return bool(await _linked_risks(db, proposal_id))


async def measure_ale_risk_value(db: AsyncSession, proposal_id) -> float:
    """Деньги под риском по мере (§17.2): Σ(ale_avg × доля_снятия) по связанным риск-событиям.
    Переиспользует _linked_risks — тот же портфель, что и ROSI (§3.1), не отдельный расчёт."""
    risks = await _linked_risks(db, proposal_id)
    pairs = [(float(r.ale_avg), share) for r, share in risks if r.ale_avg is not None]
    return measure_ale_risk(pairs)


# `CriticalityClass.value` ("MISSION CRITICAL"…) → ключ risk_appetite_by_class ("Mission
# Critical"…, econ/service.py DEFAULT_CONFIG) — разный регистр в двух местах, которые до этой
# задачи не были соединены ни одним вызовом (risk_appetite_by_class лежал неиспользуемым).
_CRITICALITY_TO_APPETITE_KEY = {
    "MISSION CRITICAL": "Mission Critical",
    "BUSINESS CRITICAL": "Business Critical",
    "BUSINESS OPERATIONAL": "Support",
}


async def _risk_appetite_for_system(db: AsyncSession, system_name: str | None) -> float | None:
    """Риск-аппетит по классу критичности ИС меры (§3.2, risk_appetite_by_class)."""
    if not system_name:
        return None
    system = (await db.execute(select(System).where(System.name == system_name))).scalar_one_or_none()
    if system is None or system.criticality_class is None:
        return None
    by_class = await config_value(db, "risk_appetite_by_class", {}) or {}
    key = _CRITICALITY_TO_APPETITE_KEY.get(system.criticality_class.value)
    return by_class.get(key) if key else None


async def route_measure(db: AsyncSession, p: Proposal) -> tuple[bool, float]:
    """Требуется ли эскалация к топ-менеджменту (§17.2, УК-43/44): (requires_escalation, ale_risk).

    is_blocking переопределяет порог через `Proposal.is_blocking_override` (денормализовано с
    Nonconformity.is_blocking при связывании, nonconformity/service.assign_measure — governance
    не импортирует nonconformity, см. models.py). regulatory берётся напрямую из связанных
    RiskEvent (governance→risk — существующее направление зависимости)."""
    risks = await _linked_risks(db, p.id)
    ale_risk = measure_ale_risk([(float(r.ale_avg), share) for r, share in risks if r.ale_avg is not None])
    regulatory = any(bool(r.regulatory) for r, _ in risks)
    appetite = await _risk_appetite_for_system(db, p.system_name)
    threshold_share = float(await config_value(db, "measure_escalation_threshold_share", 0.10) or 0.10)
    escalate = requires_escalation(
        ale_risk=ale_risk, risk_appetite=appetite, threshold_share=threshold_share,
        is_blocking=bool(p.is_blocking_override), regulatory=regulatory,
    )
    return escalate, ale_risk


# ─────────────────────────────────────────────────────────────────────────────
# §17.4 (УК-49/50) — Ц_ОМ: цена неисполнения меры ответственным
# ─────────────────────────────────────────────────────────────────────────────

def _proposal_overdue(p: Proposal, now: datetime) -> bool:
    if p.execution == "DONE":
        return False
    if p.due_on is not None:
        return p.due_on < now
    return False  # due_date-строка (legacy) не участвует — due_on источник истины (УК-36)


async def _realized_incident_costs_since(db: AsyncSession, p: Proposal, since: datetime) -> list[float]:
    """Фактический ущерб по ТС, связанным с рисками меры, произошедшим ПОСЛЕ просрочки
    (§17.4, УК-50 — для COMPENSATING). incidents/models.TechIncident.occurred_at, cost_total."""
    risk_ids = [r.id for r, _ in await _linked_risks(db, p.id)]
    if not risk_ids:
        return []
    rows = (await db.execute(
        select(TechIncident.cost_total)
        .join(RiskEventIncident, RiskEventIncident.incident_id == TechIncident.id)
        .where(RiskEventIncident.risk_event_id.in_(risk_ids), TechIncident.occurred_at >= since)
    )).scalars().all()
    return [float(c) for c in rows if c is not None]


async def compute_price_of_inaction(db: AsyncSession, p: Proposal) -> PriceOfInactionOut:
    """Ц_ОМ на карточке (§17.4) — не пишет в БД (используется и для показа, и внутри
    ежедневной задачи, которая уже сама решает, что сохранять — см. governance/tasks.py)."""
    now = _now()
    overdue = _proposal_overdue(p, now)
    _, ale_risk = await route_measure(db, p)

    if not overdue:
        return PriceOfInactionOut(
            proposal_id=p.id, measure_type=p.measure_type, is_overdue=False, ale_risk=ale_risk,
            price_snapshot=(float(p.ale_at_risk_snapshot) if p.ale_at_risk_snapshot is not None else None),
            price_snapshot_at=p.ale_at_risk_snapshot_at,
            price_current=(float(p.ale_at_risk_current) if p.ale_at_risk_current is not None else None),
            price_current_at=p.ale_at_risk_current_at,
        )

    since = p.ale_at_risk_snapshot_at or p.due_on or now
    if p.measure_type == MEASURE_COMPENSATING:
        current = price_of_inaction_compensating(await _realized_incident_costs_since(db, p, since))
    else:
        current = price_of_inaction_eliminating(ale_risk)

    return PriceOfInactionOut(
        proposal_id=p.id, measure_type=p.measure_type, is_overdue=True, ale_risk=ale_risk,
        price_snapshot=(float(p.ale_at_risk_snapshot) if p.ale_at_risk_snapshot is not None else None),
        price_snapshot_at=p.ale_at_risk_snapshot_at,
        price_current=current, price_current_at=now,
    )


async def recompute_all_overdue_price_of_inaction(db: AsyncSession) -> int:
    """Ежедневный пересчёт Ц_ОМ по всем просроченным мерам (§17.4, УК-49) — вызывается фоновой
    задачей `governance/tasks.py`. Возвращает число просроченных карточек, по которым посчитано."""
    from sqlalchemy import or_

    from app.modules.governance.models import EXECUTION_DONE, STATUS_APPROVED

    stmt = select(Proposal).where(
        Proposal.status == STATUS_APPROVED,
        or_(Proposal.execution.is_(None), Proposal.execution != EXECUTION_DONE),
        Proposal.due_on.is_not(None),
        Proposal.due_on < _now(),
    )
    overdue = list((await db.execute(stmt)).scalars().all())
    for p in overdue:
        await recompute_price_of_inaction(db, p)
    return len(overdue)


async def recompute_price_of_inaction(db: AsyncSession, p: Proposal) -> Proposal:
    """Пишет текущее значение и, при первой фиксации просрочки, снимок (§17.4, УК-49) —
    вызывается ежедневной задачей (governance/tasks.py) и по кнопке пересчёта на карточке.
    Дополнительно пишет дневную точку истории (§17.4, УК-51) — основа честной квартальной
    агрегации на переключателе «день/квартал», не повторное использование того же числа."""
    result = await compute_price_of_inaction(db, p)
    if not result.is_overdue:
        return p
    now = _now()
    if p.ale_at_risk_snapshot is None:
        p.ale_at_risk_snapshot = result.price_current
        p.ale_at_risk_snapshot_at = now
    p.ale_at_risk_current = result.price_current
    p.ale_at_risk_current_at = now
    await db.commit()
    await db.refresh(p)
    await record_daily_price_snapshot(db, p.id, now.date(), result.price_current or 0.0)
    return p


# ─────────────────────────────────────────────────────────────────────────────
# §17.4 (УК-51) — дневная история Ц_ОМ и квартальная агрегация
# ─────────────────────────────────────────────────────────────────────────────

async def record_daily_price_snapshot(
    db: AsyncSession, proposal_id, snapshot_date, price: float,
) -> None:
    """Идемпотентная запись дневной точки (§17.4) — один UPDATE вместо нового INSERT при
    повторном прогоне за тот же день (кнопка «пересчитать» + ночная задача в один день)."""
    from app.modules.governance.models import ProposalPriceSnapshot

    row = (await db.execute(
        select(ProposalPriceSnapshot).where(
            ProposalPriceSnapshot.proposal_id == proposal_id,
            ProposalPriceSnapshot.snapshot_date == snapshot_date,
        )
    )).scalar_one_or_none()
    if row is None:
        db.add(ProposalPriceSnapshot(proposal_id=proposal_id, snapshot_date=snapshot_date, price=price))
    else:
        row.price = price
    await db.commit()


def _quarter_bounds(on_date: date_cls) -> tuple[date_cls, date_cls]:
    """(начало, конец) календарного квартала, содержащего `on_date` — обе границы включительно."""
    q_start_month = ((on_date.month - 1) // 3) * 3 + 1
    start = date_cls(on_date.year, q_start_month, 1)
    next_month = q_start_month + 3
    next_year = on_date.year
    if next_month > 12:
        next_month -= 12
        next_year += 1
    end = date_cls(next_year, next_month, 1) - timedelta(days=1)
    return start, end


async def price_history(db: AsyncSession, proposal_id, *, period: str = "quarter") -> "PriceHistoryOut":
    """История дневных точек Ц_ОМ за период (§17.4, УК-51). period='quarter' — календарный
    квартал, содержащий сегодняшний день; period='day' — только сегодняшняя точка (если есть)."""
    from app.modules.governance.models import ProposalPriceSnapshot
    from app.modules.governance.schemas import PriceHistoryOut, PriceHistoryPointOut

    today = _now().date()
    if period == "day":
        since, until = today, today
    else:
        since, until = _quarter_bounds(today)

    rows = list((await db.execute(
        select(ProposalPriceSnapshot)
        .where(
            ProposalPriceSnapshot.proposal_id == proposal_id,
            ProposalPriceSnapshot.snapshot_date >= since,
            ProposalPriceSnapshot.snapshot_date <= until,
        )
        .order_by(ProposalPriceSnapshot.snapshot_date)
    )).scalars().all())

    points = [PriceHistoryPointOut(date=r.snapshot_date, price=float(r.price)) for r in rows]
    avg = round(sum(p.price for p in points) / len(points), 2) if points else None
    return PriceHistoryOut(
        proposal_id=proposal_id, period=period,
        period_start=since, period_end=until,
        points=points, period_avg=avg,
    )
