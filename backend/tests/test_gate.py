"""Юнит-тесты детерминированного шлюза правил (Rule Engine): движок выносит вердикт, не LLM."""
from app.modules.llm import gate


def test_no_rules_fired_for_healthy_system():
    r = gate.evaluate_gate(q=0.9, measured_subs=10, total_subs=10, delta_pp=0.0)
    assert not r.fired()
    assert r.severity == "none"
    assert r.as_block() == ""


def test_severity_high_when_quality_below_threshold():
    r = gate.evaluate_gate(q=0.38, measured_subs=10, total_subs=10)
    assert "severity_high" in r.codes()
    assert r.severity == "high"
    assert "38%" in r.as_block()  # число из данных (для grounding-совместимости)


def test_coverage_low_fires_below_70():
    r = gate.evaluate_gate(q=0.9, measured_subs=6, total_subs=10)
    assert "coverage_low" in r.codes()
    assert "60%" in r.as_block()


def test_regression_failed_on_degradation():
    r = gate.evaluate_gate(q=0.6, measured_subs=10, total_subs=10, delta_pp=-15.0)
    assert "regression_failed" in r.codes()


def test_coverage_plus_regression_combine_to_high():
    r = gate.evaluate_gate(q=0.6, measured_subs=6, total_subs=10, delta_pp=-15.0)
    assert set(r.codes()) == {"coverage_low", "regression_failed"}
    assert r.severity == "high"


def test_none_inputs_do_not_fire():
    r = gate.evaluate_gate(q=None, measured_subs=0, total_subs=0, delta_pp=None)
    assert not r.fired()
    assert r.severity == "none"


def test_small_degradation_below_threshold_does_not_fire():
    r = gate.evaluate_gate(q=0.6, measured_subs=10, total_subs=10, delta_pp=-5.0)
    assert "regression_failed" not in r.codes()
