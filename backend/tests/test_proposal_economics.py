"""Тесты экономики меры (BL-007, RE-11/12/13): ROSI + рекомендованный вердикт по портфелю рисков.

Эффект меры считается по СУММЕ снимаемых ALE привязанных рисков (§1.2) — иначе инфраструктурная
мера проваливает ROSI поодиночке. Вето (регуляторное/катастрофичность) имеют приоритет над ROSI.
"""
import pytest

from app.modules.governance import economics_service
from app.modules.governance.models import Proposal
from app.modules.governance.schemas import MeasureEconomicsIn
from app.modules.risk import event_service as risk_service
from app.modules.risk.event_schemas import MeasureLinkIn, RiskEventCreate
from app.shared.exceptions import ValidationError


async def _proposal(db) -> Proposal:
    p = Proposal(system_name="АБС Core", status="APPROVED")
    db.add(p)
    await db.commit()
    await db.refresh(p)
    return p


async def _risk(db, code: str, ale_avg: float, **kw):
    ev = await risk_service.create_event(db, RiskEventCreate(code=code, title="Риск"), "rm")
    ev.ale_avg = ale_avg
    for k, v in kw.items():
        setattr(ev, k, v)
    await db.commit()
    await db.refresh(ev)
    return ev


async def test_positive_rosi_recommends_eliminate(db_session):
    p = await _proposal(db_session)
    risk = await _risk(db_session, "RE-E1", 3_000_000)
    await risk_service.link_measure(db_session, risk.id, MeasureLinkIn(proposal_id=p.id))
    await economics_service.set_measure_economics(
        db_session, p, MeasureEconomicsIn(capex=500_000, opex_per_year=100_000,
                                          implementation_months=0, measure_type="ELIMINATING"),
    )
    res = await economics_service.recompute_economics(db_session, p)
    assert res.risks_count == 1
    assert res.delta_ale_per_year == 3_000_000.0     # ΔALE = ALE снимаемого риска
    assert res.rosi is not None and res.rosi > 0
    assert res.recommended_verdict == "ELIMINATE"
    assert p.recommended_verdict == "ELIMINATE" and float(p.rosi) == res.rosi


async def test_regulatory_veto_overrides_negative_rosi(db_session):
    p = await _proposal(db_session)
    risk = await _risk(db_session, "RE-R1", 100_000, regulatory=True)
    await risk_service.link_measure(db_session, risk.id, MeasureLinkIn(proposal_id=p.id))
    # Дорогая медленная мера → ROSI<0, но регуляторное вето обязывает устранять.
    await economics_service.set_measure_economics(
        db_session, p, MeasureEconomicsIn(capex=50_000_000, opex_per_year=2_000_000),
    )
    res = await economics_service.recompute_economics(db_session, p)
    assert res.rosi is not None and res.rosi < 0
    assert res.recommended_verdict == "ELIMINATE"
    assert any("регуляторное" in r for r in res.reasons)


async def test_portfolio_delta_ale_sums_with_share(db_session):
    p = await _proposal(db_session)
    r1 = await _risk(db_session, "RE-P1", 2_000_000)
    r2 = await _risk(db_session, "RE-P2", 1_000_000)
    await risk_service.link_measure(db_session, r1.id, MeasureLinkIn(proposal_id=p.id))
    await risk_service.link_measure(db_session, r2.id, MeasureLinkIn(proposal_id=p.id, ale_reduction_share=0.5))
    res = await economics_service.recompute_economics(db_session, p)
    assert res.risks_count == 2
    assert res.delta_ale_per_year == 2_500_000.0     # 2 000 000 + 0.5 × 1 000 000


async def test_manual_delta_ale_overrides_portfolio(db_session):
    p = await _proposal(db_session)
    risk = await _risk(db_session, "RE-M1", 3_000_000)
    await risk_service.link_measure(db_session, risk.id, MeasureLinkIn(proposal_id=p.id))
    await economics_service.set_measure_economics(
        db_session, p, MeasureEconomicsIn(capex=100_000, opex_per_year=50_000, delta_ale_cash=1_000_000),
    )
    res = await economics_service.recompute_economics(db_session, p)
    assert res.delta_ale_per_year == 1_000_000.0     # ручной ввод имеет приоритет над суммой рисков


async def test_set_economics_rejects_bad_measure_type(db_session):
    p = await _proposal(db_session)
    with pytest.raises(ValidationError):
        await economics_service.set_measure_economics(db_session, p, MeasureEconomicsIn(measure_type="BOGUS"))
