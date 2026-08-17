"""Тесты переписывания меры на язык исполнителя (ТЗ v19 п.16, УК-16).

Персона EXECUTOR (personas.py) уже определяет формат («Что сделать / Срок и риск / Чем
подтвердить / Что уточнить»); здесь — что вывод не содержит жаргона формул расчёта метрик и
деградирует к честному fallback'у, когда LLM недоступна или её ответ подозрителен (по образцу
test_management_summary.py), плюс инвариант состояния меры (только по одобренной, как effort_hours).
"""
import pytest

import app.modules.llm.service as llm_service
from app.modules.governance import service
from app.modules.governance.schemas import ProposalCreate
from app.modules.llm.service import (
    _JARGON_RE,
    _executor_brief_fallback,
    generate_executor_brief,
)
from app.shared.exceptions import ConflictError


def setup_function():
    llm_service._cache.clear()


def _new(**kw) -> ProposalCreate:
    # is_process_measure=True по умолчанию — см. test_governance.py._new (§17.2 не в объёме этих тестов).
    base = dict(system_name="АБС Core", characteristic="Надёжность", metric_name="Доступность (uptime)",
                rationale="Регламент резервирования узлов не соблюдается, узел восстанавливается вручную",
                expectation="Утвердить внедрение автоматического резервирования узлов", is_process_measure=True)
    base.update(kw)
    return ProposalCreate(**base)


# ─── generate_executor_brief: жаргон/grounding/fallback ───────────────────────────────

def test_fallback_contains_no_formula_jargon():
    text = _executor_brief_fallback(
        ask="Выделить ресурс на автотесты", problem="Регресс выполняется вручную",
        due_note="до 01.09.2026",
    )
    assert not _JARGON_RE.search(text)


def test_fallback_clips_long_ask_by_words():
    long_ask = " ".join(["шаг"] * 100)
    text = _executor_brief_fallback(ask=long_ask, problem="", due_note="не назначен")
    assert len(text.split()) < 100  # обрезано, не выведено целиком


def test_fallback_used_when_llm_unavailable(monkeypatch):
    monkeypatch.setattr(llm_service, "complete", lambda *a, **k: None)
    text = generate_executor_brief(
        title="Доступность (uptime)", problem="Регламент резервирования не соблюдается",
        ask="Внедрить автоматическое резервирование узлов", due_note="до 01.09.2026",
    )
    expected = _executor_brief_fallback(
        ask="Внедрить автоматическое резервирование узлов",
        problem="Регламент резервирования не соблюдается", due_note="до 01.09.2026",
    )
    assert text == expected


def test_generate_rejects_llm_output_with_formula_jargon(monkeypatch):
    monkeypatch.setattr(llm_service, "complete",
                        lambda *a, **k: "Что сделать: настроить X = 50%. Срок: до 01.09.2026.")
    text = generate_executor_brief(
        title="Доступность (uptime)", problem="Проблема", ask="Внедрить резервирование",
        due_note="до 01.09.2026",
    )
    assert not _JARGON_RE.search(text)


def test_generate_rejects_echo_of_facts_with_own_labels(monkeypatch):
    """Регресс: найдено вживую (браузерная проверка) — модель пересказала факты своими
    лейблами («Поручение:/Контекст:/Решение:/Срок:») вместо формата персоны EXECUTOR, с
    markdown-разметкой и оборванной секцией в конце. Жаргона/лишних чисел нет — только
    _is_echo ловит этот брак."""
    echo = (
        "**Поручение:** Внедрить резервирование\n\n"
        "**Контекст:** Регламент резервирования не соблюдается\n\n"
        "**Решение:** Внедрить резервирование\n\n"
        "**Срок:** до 01.09.2026\n\n**Переписка:**"
    )
    monkeypatch.setattr(llm_service, "complete", lambda *a, **k: echo)
    text = generate_executor_brief(
        title="Доступность (uptime)", problem="Регламент резервирования не соблюдается",
        ask="Внедрить резервирование", due_note="до 01.09.2026",
    )
    assert text != echo
    assert text == _executor_brief_fallback(
        ask="Внедрить резервирование", problem="Регламент резервирования не соблюдается",
        due_note="до 01.09.2026",
    )


def test_generate_accepts_compliant_llm_output(monkeypatch):
    good = ("Что сделать: настроить автоматическое резервирование узлов согласно регламенту. "
            "Срок и риск: до 01.09.2026, риск — нехватка тестового окна. "
            "Чем подтвердить: отчёт о прохождении нагрузочного теста резервирования.")
    monkeypatch.setattr(llm_service, "complete", lambda *a, **k: good)
    text = generate_executor_brief(
        title="Доступность (uptime)", problem="Проблема", ask="Внедрить резервирование",
        due_note="до 01.09.2026",
    )
    assert text == good


# ─── rewrite_for_executor: инвариант состояния (только по одобренной) ─────────────────

async def test_rewrite_requires_approved(db_session, monkeypatch):
    monkeypatch.setattr(llm_service, "complete", lambda *a, **k: None)
    p = await service.create(db_session, _new(), "manager")
    with pytest.raises(ConflictError):
        await service.rewrite_for_executor(db_session, p, None)
    p = await service.decide(db_session, p, approve=True, comment=None, username="admin")
    p = await service.rewrite_for_executor(db_session, p, None)
    assert p.executor_brief
    assert p.executor_brief_generated_at is not None
    assert not _JARGON_RE.search(p.executor_brief)


async def test_rewrite_reflects_due_date_when_present(db_session, monkeypatch):
    monkeypatch.setattr(llm_service, "complete", lambda *a, **k: None)
    p = await service.create(db_session, _new(due_date="01.09.2026"), "manager")
    p = await service.decide(db_session, p, approve=True, comment=None, username="admin")
    p = await service.rewrite_for_executor(db_session, p, None)
    assert "01.09.2026" in p.executor_brief
