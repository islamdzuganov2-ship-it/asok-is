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

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.econ import DecisionInput, config_value, decide, rosi
from app.modules.governance.models import MEASURE_TYPES, VERDICTS, Proposal
from app.modules.governance.schemas import MeasureEconomicsIn, MeasureEconomicsResult
from app.modules.risk import RiskEvent, RiskEventMeasure
from app.shared.exceptions import ValidationError


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
