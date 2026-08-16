"""Тесты карточки меры на языке топ-менеджмента (ТЗ v19 п.14, УК-14).

Критерии приёмки (по образцу test_reasoning.py::test_no_methodology_jargon_in_user_facing_output,
_FORBIDDEN_TERMS): в тексте для руководителя нет технического жаргона формул расчёта метрик
(«X =», «A/B», DIRECT/INVERSE); деньги/срок/ответственный ВСЕГДА отражены — реальным значением
или честной пометкой «не оценено»/«не назначен», не пропущены молча; лимит 80 слов держится,
даже когда исходные обоснование/ожидание — длинный свободный текст.
"""
import app.modules.llm.service as llm_service
from app.modules.governance.management_summary import build_management_summary
from app.modules.governance.models import Proposal
from app.modules.llm.service import (
    _JARGON_RE,
    _management_summary_fallback,
    generate_management_summary,
)


def setup_function():
    llm_service._cache.clear()


# ─── Жаргон формул: запрет на уровне регулярки и на уровне fallback ───────────────────

def test_jargon_regex_catches_known_patterns():
    for bad in ("X = 50%", "Х=80", "оценка A/B", "тип DIRECT", "формула INVERSE"):
        assert _JARGON_RE.search(bad), f"регулярка не поймала жаргон: {bad!r}"


def test_jargon_regex_does_not_flag_normal_prose():
    normal = ("Бездействие обходится ориентировочно в 500 000 ₽/год; решение нужно "
              "до 01.09.2026. Ответственный: Иванов И.И.")
    assert not _JARGON_RE.search(normal)


def test_fallback_contains_no_formula_jargon():
    text = _management_summary_fallback(
        problem="Регресс выполняется вручную, есть просадка тестируемости",
        ask="Выделить ресурс на автотесты",
        money_note="500 000 ₽/год", deadline_note="до 01.09.2026",
        cost_note="разово 300 000 ₽", result_note="риск ниже на 500 000 ₽/год",
        responsible_note="Иванов И.И.",
    )
    assert not _JARGON_RE.search(text)


# ─── Лимит 80 слов — держится даже на длинном свободном тексте ────────────────────────

def test_fallback_respects_word_limit_with_long_free_text():
    long_problem = " ".join(["слово"] * 200)
    long_ask = " ".join(["решение"] * 200)
    text = _management_summary_fallback(
        problem=long_problem, ask=long_ask,
        money_note="500 000 ₽/год", deadline_note="до 01.09.2026",
        cost_note="разово 300 000 ₽", result_note="риск ниже на 500 000 ₽/год",
        responsible_note="Иванов И.И.",
    )
    assert len(text.split()) <= 80


# ─── Деньги/срок/ответственный — не ноль молча ─────────────────────────────────────────

def test_fallback_flags_absent_facts_honestly_not_as_zero():
    text = _management_summary_fallback(
        problem="Проблема есть", ask="Решение нужно",
        money_note="не оценено", deadline_note="не назначен",
        cost_note="не оценено", result_note="не оценено", responsible_note="не назначен",
    )
    assert "не оценено" in text and "не назначен" in text
    assert "0 ₽" not in text and " 0." not in text


def test_fallback_never_silently_drops_a_section():
    text = _management_summary_fallback(
        problem="", ask="",
        money_note="не оценено", deadline_note="не назначен",
        cost_note="не оценено", result_note="не оценено", responsible_note="не назначен",
    )
    for label in ("Что не так", "Деньги и срок", "Решение", "Стоимость", "Результат", "Ответственный"):
        assert label in text, f"секция «{label}» пропала при пустых входах"


# ─── generate_management_summary: пост-проверка LLM-вывода, честный fallback ──────────

_ARGS = dict(
    problem="Регресс выполняется вручную", ask="Выделить ресурс на автотесты",
    money_note="500 000 ₽/год", deadline_note="до 01.09.2026",
    cost_note="разово 300 000 ₽", result_note="риск ниже на 500 000 ₽/год",
)


def test_generate_uses_fallback_when_llm_unavailable(monkeypatch):
    monkeypatch.setattr(llm_service, "complete", lambda *a, **k: None)
    text = generate_management_summary(**_ARGS, responsible_note="Иванов И.И.", responsible_name="Иванов И.И.")
    expected = _management_summary_fallback(**_ARGS, responsible_note="Иванов И.И.")
    assert text == expected


def test_generate_rejects_llm_output_with_formula_jargon(monkeypatch):
    monkeypatch.setattr(llm_service, "complete",
                        lambda *a, **k: "Проблема: X = 50%. Деньги: 500 000 ₽. Срок: 01.09.2026. Ответственный: Иванов И.И.")
    text = generate_management_summary(**_ARGS, responsible_note="Иванов И.И.", responsible_name="Иванов И.И.")
    assert not _JARGON_RE.search(text)
    assert text == _management_summary_fallback(**_ARGS, responsible_note="Иванов И.И.")


def test_generate_rejects_llm_output_over_word_limit(monkeypatch):
    long_text = " ".join(["слово"] * 120) + " 500 000 ₽ 01.09.2026 Иванов"
    monkeypatch.setattr(llm_service, "complete", lambda *a, **k: long_text)
    text = generate_management_summary(**_ARGS, responsible_note="Иванов И.И.", responsible_name="Иванов И.И.")
    assert len(text.split()) <= 80


def test_generate_rejects_llm_output_missing_responsible(monkeypatch):
    # Деньги/срок названы, ответственный потерян и не помечен отсутствующим — брак.
    monkeypatch.setattr(llm_service, "complete",
                        lambda *a, **k: "Бездействие стоит 500 000 ₽/год, решение нужно до 01.09.2026.")
    text = generate_management_summary(**_ARGS, responsible_note="Иванов И.И.", responsible_name="Иванов И.И.")
    assert text == _management_summary_fallback(**_ARGS, responsible_note="Иванов И.И.")


def test_generate_rejects_llm_output_that_echoes_facts_but_drops_the_ask(monkeypatch):
    """Регресс: найдено вживую (браузерная проверка) — маленькая модель пересказала «Что не
    так»/деньги/срок/ответственного, но полностью потеряла раздел «Решение». Деньги/срок/
    ответственный проходят по отдельности, поэтому только проверка _covers_ask ловит брак."""
    problem = "Регламент резервирования узлов не соблюдается, узел восстанавливается вручную"
    ask = "Утвердить внедрение автоматического резервирования узлов и выделить бюджет"
    echo_without_ask = (
        "Что не так: регламент резервирования узлов не соблюдается. "
        "Деньги: 500 000 ₽/год. Срок: до 01.09.2026. Ответственный: Иванов И.И."
    )
    monkeypatch.setattr(llm_service, "complete", lambda *a, **k: echo_without_ask)
    text = generate_management_summary(
        problem=problem, ask=ask, money_note="500 000 ₽/год", deadline_note="до 01.09.2026",
        cost_note="разово 300 000 ₽", result_note="риск ниже на 500 000 ₽/год",
        responsible_note="Иванов И.И.", responsible_name="Иванов И.И.",
    )
    assert text != echo_without_ask
    assert text == _management_summary_fallback(
        problem=problem, ask=ask, money_note="500 000 ₽/год", deadline_note="до 01.09.2026",
        cost_note="разово 300 000 ₽", result_note="риск ниже на 500 000 ₽/год",
        responsible_note="Иванов И.И.",
    )


def test_generate_accepts_compliant_llm_output(monkeypatch):
    good = ("Что не так: регресс выполняется вручную, тесты не успевают за релизами. "
            "Деньги и срок: простой обходится в 500 000 ₽/год, решение нужно до 01.09.2026. "
            "Решение: выделить ресурс на автотесты. Стоимость: разово 300 000 ₽. "
            "Результат: риск ниже на 500 000 ₽/год. Ответственный: Иванов И.И.")
    monkeypatch.setattr(llm_service, "complete", lambda *a, **k: good)
    text = generate_management_summary(**_ARGS, responsible_note="Иванов И.И.", responsible_name="Иванов И.И.")
    assert text == good  # добросовестный вывод не подменяется fallback'ом


# ─── build_management_summary: сборка фактов меры (governance.Proposal) ──────────────

def _proposal(**kw) -> Proposal:
    base = dict(
        system_name="АБС Core", characteristic="Надёжность",
        rationale="Регресс выполняется вручную, тестируемость просела", expectation="Выделить ресурс на автотесты",
        status="APPROVED",
    )
    base.update(kw)
    return Proposal(**base)


def test_build_summary_all_facts_present(monkeypatch):
    monkeypatch.setattr(llm_service, "complete", lambda *a, **k: None)  # детерминированный путь
    p = _proposal(
        capex=300_000, opex_per_year=20_000, delta_ale_cash=500_000,
        due_date="01.09.2026", owner="Иванов И.И.", owner_role="Руководитель эксплуатации",
        expected_delta_score=5,
    )
    out = build_management_summary(p)
    assert out.has_money and out.has_deadline and out.has_responsible
    assert out.missing == []
    assert out.word_count <= 80
    assert not _JARGON_RE.search(out.text)


def test_build_summary_missing_facts_flagged_not_zero(monkeypatch):
    monkeypatch.setattr(llm_service, "complete", lambda *a, **k: None)
    p = _proposal()  # без capex/opex/delta_ale/due_date/owner
    out = build_management_summary(p)
    assert not out.has_money and not out.has_deadline and not out.has_responsible
    assert set(out.missing) == {"деньги", "срок", "ответственный"}
    assert "не оценено" in out.text and "не назначен" in out.text
    assert "0 ₽" not in out.text
