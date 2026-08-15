"""Фактическая результативность мер: ΔScore «до/после» (ДЕФ-32 / БТ-134, T-15).

В системе жил только ПЛАНОВЫЙ `expected_delta_score`, который вводит человек. Фактического
сравнения не было: на графике динамики рисовались лишь метки мер, и ответить «привела ли
мера к улучшению» приходилось глазами. Заказчик формулировал это как обязательное:
«должен понимать, эффективны ли принятые меры и приводят ли они к улучшению».
"""
from app.modules.reporting.router import (
    DynamicsPoint, MeasureMarker, EFFECT_NOISE_PP, _measure_effects,
)

FUNC = "Функциональная пригодность"
RELI = "Надёжность"


def _points() -> list[DynamicsPoint]:
    return [
        DynamicsPoint(period="Q1-2026", integral=40.0, characteristics={FUNC: 30.0, RELI: 50.0}),
        DynamicsPoint(period="Q2-2026", integral=45.0, characteristics={FUNC: 42.0, RELI: 48.0}),
        DynamicsPoint(period="Q3-2026", integral=47.0, characteristics={FUNC: 41.5, RELI: 52.0}),
    ]


def _measure(char: str, created: str, title: str = "Мера") -> MeasureMarker:
    return MeasureMarker(characteristic=char, created_at=created, title=title, status="APPROVED")


def test_improvement_is_detected():
    """Мера принята в Q1, в Q2 характеристика выросла на 12 п.п."""
    effects = _measure_effects(_points(), [_measure(FUNC, "2026-02-10T10:00:00+00:00")])
    assert len(effects) == 1
    e = effects[0]
    assert (e.period_before, e.period_after) == ("Q1-2026", "Q2-2026")
    assert e.score_before == 30.0 and e.score_after == 42.0
    assert e.delta == 12.0 and e.verdict == "улучшение"


def test_degradation_is_detected():
    effects = _measure_effects(_points(), [_measure(RELI, "2026-02-10T10:00:00+00:00")])
    assert effects[0].delta == -2.0 and effects[0].verdict == "ухудшение"


def test_small_change_is_noise_not_result():
    """Изменение в пределах порога — «без изменений», а не победа на 0.5 п.п."""
    effects = _measure_effects(_points(), [_measure(FUNC, "2026-05-10T10:00:00+00:00")])
    assert effects[0].period_before == "Q2-2026"
    assert abs(effects[0].delta) <= EFFECT_NOISE_PP
    assert effects[0].verdict == "без изменений"


def test_measure_without_following_period_is_skipped():
    """Свежая мера без следующего периода не показывается вовсе.

    Честнее не показать результат, чем выдать ноль за «без изменений».
    """
    assert _measure_effects(_points(), [_measure(FUNC, "2026-08-10T10:00:00+00:00")]) == []


def test_measure_before_first_period_is_skipped():
    assert _measure_effects(_points(), [_measure(FUNC, "2025-01-10T10:00:00+00:00")]) == []


def test_measure_without_date_is_skipped():
    assert _measure_effects(_points(), [_measure(FUNC, "")]) == []


def test_characteristic_absent_in_period_is_skipped():
    """Если по характеристике в периоде нет оценки — сравнивать нечего."""
    points = [
        DynamicsPoint(period="Q1-2026", integral=40.0, characteristics={RELI: 50.0}),
        DynamicsPoint(period="Q2-2026", integral=45.0, characteristics={RELI: 55.0}),
    ]
    assert _measure_effects(points, [_measure(FUNC, "2026-02-10T10:00:00+00:00")]) == []


def test_single_period_gives_no_effects():
    one = [DynamicsPoint(period="Q1-2026", integral=40.0, characteristics={FUNC: 30.0})]
    assert _measure_effects(one, [_measure(FUNC, "2026-02-10T10:00:00+00:00")]) == []


def test_broken_date_does_not_crash():
    assert _measure_effects(_points(), [_measure(FUNC, "не дата")]) == []
