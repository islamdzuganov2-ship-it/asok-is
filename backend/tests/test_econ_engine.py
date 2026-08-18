"""Юнит-тесты экономического движка (BL-007, RE-07/09/12/13).

Движок — чистые функции без БД, поэтому тесты не требуют фикстур/Postgres. Закрепляют формулы
§2–§3 ТЗ: C_ТС, ступенчатую деградацию, ALE (средний/P90/Max), ROSI с лагом внедрения и логику
вето → вердикт (устранить/компенсировать/принять).
"""
from datetime import date

from app.modules.econ.economics import (
    DISCOUNT_RATE_ANNUAL,
    HORIZON_MONTHS,
    K_TIME_WEEKEND,
    DecisionInput,
    DowntimeEntry,
    LineLabor,
    annual_loss_expectancy,
    cost_incident,
    cost_recovery,
    decide,
    degradation_counts_as_downtime,
    k_functional_degradation,
    k_performance_degradation,
    measure_effect_timeline,
    k_throughput_degradation,
    rosi,
)


# ── C_ТС (§2.1) ──

def test_cost_recovery_sums_lines_with_time_coefficient():
    # L2 3ч × 2000 ×1.0 + L3 1ч × 5000 × K_выходные(2.0) = 6000 + 10000
    labors = [LineLabor(3, 2000), LineLabor(1, 5000, k_time=K_TIME_WEEKEND)]
    assert cost_recovery(labors) == 16000.0


def test_cost_incident_combines_recovery_downtime_secondary():
    labors = [LineLabor(2, 1500)]                       # 3000
    downtime = [DowntimeEntry(minutes=60, cost_per_min=500)]  # 30000
    assert cost_incident(labors, downtime, secondary=1000) == 34000.0


def test_downtime_applies_k_impact_and_share():
    # деградация: 100 мин × 800 ₽/мин × K 0.5 × доля 0.5 = 20000
    entry = DowntimeEntry(minutes=100, cost_per_min=800, k_impact=0.5, share=0.5)
    assert cost_incident(downtime=[entry]) == 20000.0


# ── Деградация → K (§2.2) ──

def test_performance_degradation_stepwise_scale():
    assert k_performance_degradation(1) == 0.0
    assert k_performance_degradation(2) == 0.2
    assert k_performance_degradation(3) == 0.35
    assert k_performance_degradation(5) == 0.5
    assert k_performance_degradation(10) == 0.8
    assert k_performance_degradation(50) == 1.0   # > ×10 → таймауты


def test_functional_and_throughput_degradation():
    assert k_functional_degradation(3, 10) == 0.3
    assert k_throughput_degradation(actual=80, required=100) == 0.2
    # защита от деления на ноль / выхода за диапазон
    assert k_functional_degradation(5, 0) == 0.0
    assert k_throughput_degradation(120, 100) == 0.0


def test_degradation_converts_to_downtime_only_above_thresholds():
    assert degradation_counts_as_downtime(k_impact=0.8, minutes=20) is True
    assert degradation_counts_as_downtime(k_impact=0.8, minutes=10) is False   # коротко
    assert degradation_counts_as_downtime(k_impact=0.5, minutes=60) is False   # слабо


# ── ALE (§2.3) ──

def test_ale_triple_avg_p90_max():
    res = annual_loss_expectancy(aro=4, sle_avg=250000, sle_p90=600000, max_sle=5_000_000)
    assert res.ale_avg == 1_000_000.0
    assert res.ale_p90 == 2_400_000.0
    assert res.max_sle == 5_000_000.0


def test_ale_without_tail_returns_none_for_p90_and_max():
    res = annual_loss_expectancy(aro=2, sle_avg=100000)
    assert res.ale_avg == 200000.0
    assert res.ale_p90 is None and res.max_sle is None


# ── ROSI (§3.1) ──

def test_rosi_positive_when_benefit_exceeds_tco():
    # Дешёвая мера, снимающая большой ALE, — очевидное устранение.
    res = rosi(capex=500_000, opex_per_year=100_000, delta_ale_per_year=3_000_000)
    assert res.rosi > 0
    assert res.benefit_pv > res.cost_pv


def test_rosi_negative_for_expensive_slow_measure():
    res = rosi(capex=50_000_000, opex_per_year=2_000_000, delta_ale_per_year=1_000_000)
    assert res.rosi < 0


def test_implementation_lag_reduces_benefit():
    """Лаг внедрения съедает часть выгоды на коротком горизонте (§3.1) — тот же ΔALE даёт меньший ROSI."""
    fast = rosi(capex=1_000_000, opex_per_year=200_000, delta_ale_per_year=2_000_000,
                implementation_months=0)
    slow = rosi(capex=1_000_000, opex_per_year=200_000, delta_ale_per_year=2_000_000,
                implementation_months=9)
    assert slow.benefit_pv < fast.benefit_pv
    assert slow.rosi < fast.rosi


def test_rosi_defaults_match_accepted_params():
    assert HORIZON_MONTHS == 24
    assert 0 < DISCOUNT_RATE_ANNUAL < 1


# ── Вердикт: вето + ROSI (§3.2) ──

def test_regulatory_veto_forces_eliminate_regardless_of_rosi():
    res = decide(DecisionInput(rosi=-0.9, ale=100, risk_appetite=10_000_000, regulatory=True))
    assert res.verdict == "ELIMINATE"
    assert "регуляторное" in res.reasons[0]


def test_catastrophe_veto_forces_eliminate():
    res = decide(DecisionInput(rosi=-0.5, ale=1000, risk_appetite=10_000_000,
                               max_sle=50_000_000, catastrophe_threshold=20_000_000))
    assert res.verdict == "ELIMINATE"


def test_positive_rosi_eliminates():
    assert decide(DecisionInput(rosi=0.3, ale=5_000_000, risk_appetite=1_000_000)).verdict == "ELIMINATE"


def test_negative_rosi_above_appetite_compensates():
    res = decide(DecisionInput(rosi=-0.2, ale=5_000_000, risk_appetite=1_000_000))
    assert res.verdict == "COMPENSATE"


def test_negative_rosi_within_appetite_accepts():
    res = decide(DecisionInput(rosi=-0.2, ale=500_000, risk_appetite=1_000_000))
    assert res.verdict == "ACCEPT"


# ── ТЗ v19 п.15 (УК-37): эффект меры во времени ──

def test_effect_timeline_not_computable_without_start_date():
    r = measure_effect_timeline(None, 2, 100_000, 10_000, 60_000)
    assert r.computable is False
    assert r.reason


def test_effect_timeline_effect_starts_after_lag_not_immediately():
    # старт 2026-01-15, лаг 2 мес → выход на эффект ~2026-03-15 (квартал Q1 всё ещё, т.к. март в Q1).
    r = measure_effect_timeline(date(2026, 1, 15), 2, 0, 0, 400_000, horizon_quarters=4)
    assert r.effect_start_date == date(2026, 3, 15)
    # Первый квартал (Q1, содержит и старт, и дату выхода на эффект) — эффект уже активен,
    # т.к. граница считается по КВАРТАЛУ, не по дню (В-48: гранулярность — квартал).
    assert r.points[0].net_cash == 100_000.0  # 400000/4


def test_effect_timeline_zero_before_effect_quarter_when_lag_crosses_quarter():
    # старт 2026-01-15, лаг 5 мес → выход на эффект 2026-06-15 (Q2) — Q1 должен быть 0.
    r = measure_effect_timeline(date(2026, 1, 15), 5, 0, 0, 400_000, horizon_quarters=3)
    assert r.effect_start_date == date(2026, 6, 15)
    assert r.points[0].quarter_label == "2026-Q1"
    assert r.points[0].net_cash == 0.0
    assert r.points[1].quarter_label == "2026-Q2"
    assert r.points[1].net_cash == 100_000.0


def test_effect_timeline_payback_accounts_for_lag_not_creation_date():
    # CAPEX 100000, эффект 400000/год (100000/квартал), лаг 3 мес (выход в Q2) — окупаемость
    # НЕ в Q1 (эффект ещё не начался), а в Q2 (первый квартал с ненулевым эффектом: -100000+100000=0).
    r = measure_effect_timeline(date(2026, 1, 1), 3, 100_000, 0, 400_000, horizon_quarters=4)
    assert r.points[0].net_cash == 0.0
    assert r.points[0].cumulative == -100_000.0   # CAPEX списан сразу, эффекта ещё нет
    assert r.payback_quarter == "2026-Q2"
    assert r.points[1].cumulative == 0.0


def test_effect_timeline_never_pays_back_when_no_effect():
    r = measure_effect_timeline(date(2026, 1, 1), 0, 500_000, 0, 0, horizon_quarters=4)
    assert r.payback_quarter is None
    assert all(p.net_cash == 0.0 for p in r.points)


def test_effect_timeline_opex_reduces_quarterly_net():
    r = measure_effect_timeline(date(2026, 1, 1), 0, 0, 40_000, 200_000, horizon_quarters=1)
    # (200000 - 40000) / 4 = 40000
    assert r.points[0].net_cash == 40_000.0
