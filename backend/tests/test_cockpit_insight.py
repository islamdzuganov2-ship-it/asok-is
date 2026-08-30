"""AI-резюме кокпита (ТЗ v21 §9.2, КП-42) — одна строка под заголовком, живой вызов в фоне
с гарантированным fallback (не блокирует «ответ за 10 секунд» ожиданием генерации 12B/CPU)."""
from unittest.mock import patch

from app.modules.reporting.router import (
    CockpitInsightIn,
    _cockpit_insight_grounded,
    cockpit_insight,
)


def test_grounded_accepts_numbers_present_in_facts():
    facts = {"ALE": "10 700 000 ₽", "Риски": "3 шт."}
    assert _cockpit_insight_grounded("Под риском 10 700 000 ₽ по трём событиям.", facts)


def test_grounded_rejects_invented_numbers():
    facts = {"ALE": "10 700 000 ₽"}
    assert not _cockpit_insight_grounded("Под риском 25 000 000 ₽.", facts)


def test_grounded_ignores_single_digit_noise():
    # Однозначные числа («1 шт.») слишком часты, чтобы служить сигналом галлюцинации.
    facts = {"Риски": "3 шт."}
    assert _cockpit_insight_grounded("Ситуация требует внимания уже сегодня.", facts)


async def test_falls_back_when_llm_unavailable(db_session):
    payload = CockpitInsightIn(role="CEO", facts={"ALE": "10 700 000 ₽"}, fallback="Портфель под риском на 10,7 млн ₽.")
    with patch("app.modules.reporting.router.llm_service.complete", return_value=None):
        result = await cockpit_insight(payload, _={})
    assert result.llm is False
    assert result.text == payload.fallback


async def test_falls_back_when_llm_hallucinates():
    payload = CockpitInsightIn(role="CEO", facts={"ALE": "10 700 000 ₽"}, fallback="Портфель под риском на 10,7 млн ₽.")
    with patch("app.modules.reporting.router.llm_service.complete", return_value="Риск оценивается в 99 000 000 ₽."):
        result = await cockpit_insight(payload, _={})
    assert result.llm is False
    assert result.text == payload.fallback


async def test_falls_back_when_llm_uses_jargon():
    payload = CockpitInsightIn(role="CEO", facts={"ALE": "10 700 000 ₽"}, fallback="Портфель под риском на 10,7 млн ₽.")
    with patch("app.modules.reporting.router.llm_service.complete", return_value="Детерминированный движок оценил риск в 10 700 000 ₽."):
        result = await cockpit_insight(payload, _={})
    assert result.llm is False
    assert result.text == payload.fallback


async def test_uses_llm_text_when_grounded_and_clean():
    payload = CockpitInsightIn(role="CEO", facts={"ALE": "10 700 000 ₽"}, fallback="Портфель под риском на 10,7 млн ₽.")
    with patch("app.modules.reporting.router.llm_service.complete", return_value="Портфель под риском на 10 700 000 ₽ — стоит начать с крупнейшей ИС."):
        result = await cockpit_insight(payload, _={})
    assert result.llm is True
    assert "10 700 000" in result.text
