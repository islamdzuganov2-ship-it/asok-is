"""Юнит-тесты конвейера многоаспектного рассуждения (BL-005, Дао Тойота × ISO 25010/38500).

Критерии приёмки манифеста (часть VII):
  1) заключение — только после Э0–Э6, трасса аудируема;
  2) минимум 3 ролевые линзы (Немаваси);
  3) grounding сохранён (Дзидока): чисел вне входа нет, при нехватке данных — честная оговорка;
  4) есть блоки первопричины (5 Почему) и саморефлексии (Хансей).
"""
import pytest

import app.modules.llm.service as llm
from app.modules.llm import reasoning
from app.modules.llm.reasoning import ReasoningInput, generate_reasoned_conclusion, run_reasoning

JUDGMENTS = (
    "Сопровождаемость / Тестируемость: покрытие автотестами 25%, регресс выполняется вручную\n"
    "Надёжность / Доступность (uptime): за квартал два инцидента недоступности"
)
RISKS = (
    "- Низкая автоматизация регрессионного тестирования: выделить ресурс на автотесты\n"
    "- Риск недоступности сервиса: ввести резервирование узлов"
)


def _inp(**kw) -> ReasoningInput:
    base = dict(system_name="ЕХД", period_label="Q2-2026",
                judgments_block=JUDGMENTS, risks_block=RISKS)
    base.update(kw)
    return ReasoningInput(**base)


def setup_function():
    reasoning._cache.clear()
    llm._cache.clear()


# ─── Критерий 1: все этапы, порядок, заключение последним ────────────────────────────

def test_trace_contains_all_stages_in_order():
    trace = run_reasoning(_inp(), use_llm=False)
    assert [s.code for s in trace.stages] == ["E0", "E1", "E2", "E3", "E4", "E5", "E6", "E7"]
    assert trace.conclusion == trace.stage("E7").content
    assert trace.conclusion.strip()


# ─── Критерий 2: Немаваси — минимум 3 линзы ──────────────────────────────────────────

def test_minimum_three_lenses_applied():
    trace = run_reasoning(_inp(), use_llm=False)
    assert len(trace.lenses) >= 3
    assert all(lens.view.strip() for lens in trace.lenses)


def test_less_than_three_lenses_rejected():
    with pytest.raises(ValueError):
        run_reasoning(_inp(), use_llm=False, lens_codes=("CIO", "QUALITY"))


# ─── Критерий 3: Дзидока / grounding ─────────────────────────────────────────────────

def test_pipeline_fully_deterministic_without_llm(monkeypatch):
    monkeypatch.setattr(llm, "complete", lambda *a, **k: None)
    trace = run_reasoning(_inp())
    assert trace.llm_used is False
    assert all(s.grounded for s in trace.stages)
    assert trace.conclusion.strip()
    # детерминированные меры собраны из минимизаций базы рисков
    assert "закрывает риск" in trace.stage("E5").content


def test_hallucinated_pct_triggers_andon_fallback(monkeypatch):
    # LLM во всех проходах «придумывает» 99%, которого нет во входе → каждый проход отбраковывается.
    monkeypatch.setattr(llm, "complete", lambda *a, **k: "ПРОБЛЕМА: рост дефектов на 99%.")
    trace = run_reasoning(_inp())
    joined = " ".join(s.content for s in trace.stages) + trace.conclusion
    assert "99%" not in joined
    assert trace.stage("E1").fell_back and trace.stage("E2").fell_back
    assert "E1" in trace.stage("E4").content  # Дзидока фиксирует отбраковку в трассе


def test_grounded_llm_output_is_kept(monkeypatch):
    def fake_complete(prompt, system=None, max_tokens=None, temperature=None):
        if "ПРОБЛЕМА" in prompt:
            return ("ПРОБЛЕМА: тестируемость на уровне 25%, регресс ручной.\n"
                    "ПЕРВОПРИЧИНА: нет ресурса на автотесты; данных для следующего «почему» нет.")
        if "ЛИНЗА" in prompt:
            return ("ЛИНЗА CIO: ручной регресс замедляет поставку ценности.\n"
                    "ЛИНЗА QUALITY: просела тестируемость (25%).\n"
                    "ЛИНЗА RISK: активируется риск низкой автоматизации регресса.\n"
                    "ЛИНЗА SECURITY: сигналов по защищённости во входных данных нет.")
        return ("МЕРЫ: выделить ресурс на автотесты → закрывает риск низкой автоматизации.\n"
                "ЗАКЛЮЧЕНИЕ: качество ниже целевого из-за тестируемости 25%; выделить ресурс на автоматизацию.")
    monkeypatch.setattr(llm, "complete", fake_complete)
    trace = run_reasoning(_inp())
    assert trace.llm_used is True
    assert trace.stage("E1").used_llm and "25%" in trace.stage("E1").content
    assert all(lens.used_llm for lens in trace.lenses)
    assert trace.stage("E7").used_llm and "25%" in trace.conclusion


# ─── Критерий 3 (продолжение): честное «данные отсутствуют» ──────────────────────────

def test_genchi_genbutsu_reports_absent_sources():
    trace = run_reasoning(_inp(measures_block=""), use_llm=False)
    e0 = trace.stage("E0").content
    assert "Карточки мер: данные отсутствуют" in e0
    assert "Профессиональные суждения:" in e0  # переданное — присутствует как факт
    # Хансей называет непереданные источники
    assert "карточки мер" in trace.stage("E6").content


# ─── Критерий 4: контракт заключения ЛПР (6 блоков) и обязательные этапы ─────────────

def test_conclusion_contract_sections_present():
    trace = run_reasoning(_inp(), use_llm=False)
    for block in ("Рассмотренные аспекты", "Первопричина", "Активируемые риски",
                  "Предлагаемые меры", "Рекомендация ЛПР", "Уверенность и оговорки"):
        assert block in trace.conclusion, f"нет блока: {block}"
    # первопричина и рефлексия — из соответствующих этапов
    assert trace.stage("E2").content.split()[0] in trace.conclusion
    assert "Уверенность:" in trace.stage("E6").content


def test_measures_not_synthesized_without_sources(monkeypatch):
    # Дзидока: без карточек мер и рисков LLM про меры не спрашиваем — любой ответ был бы выдумкой.
    monkeypatch.setattr(llm, "complete",
                        lambda *a, **k: "МЕРЫ: внедрить новый стенд.\nЗАКЛЮЧЕНИЕ: всё в порядке.")
    trace = run_reasoning(_inp(risks_block="", measures_block=""))
    assert trace.stage("E5").fell_back
    assert "внедрить новый стенд" not in trace.stage("E5").content
    assert "отсутств" in trace.stage("E5").content.lower()
    # а заключение от LLM при этом принять можно
    assert trace.stage("E7").used_llm


def test_degenerate_repetition_rejected(monkeypatch):
    # Зацикленный повтор («данных отсутствия данных отсутствия…») — андон, а не заключение.
    loop = "ЗАКЛЮЧЕНИЕ: " + "данных отсутствия " * 40
    monkeypatch.setattr(llm, "complete", lambda *a, **k: loop)
    trace = run_reasoning(_inp())
    assert trace.stage("E7").fell_back
    assert trace.conclusion.count("данных отсутствия") <= 1


def test_placeholder_echo_rejected(monkeypatch):
    # Мелкая модель может эхо-скопировать скелет формата — плейсхолдер не считается ответом.
    monkeypatch.setattr(llm, "complete",
                        lambda *a, **k: "ПРОБЛЕМА: <1–2 предложения>\nПЕРВОПРИЧИНА: <цепочка «почему»>")
    trace = run_reasoning(_inp())
    assert trace.stage("E1").fell_back and trace.stage("E2").fell_back
    assert "<" not in trace.conclusion


def test_confidence_derived_from_data_completeness():
    poor = run_reasoning(ReasoningInput("ИС", "Q1", judgments_block=""), use_llm=False)
    ok = run_reasoning(_inp(), use_llm=False)
    assert poor.confidence == "низкая"
    assert ok.confidence in ("средняя", "высокая")


# ─── Высокоуровневый вход и датасет ──────────────────────────────────────────────────

def test_generate_reasoned_conclusion_shape_and_cache(monkeypatch):
    monkeypatch.setattr(llm, "complete", lambda *a, **k: None)
    r1 = generate_reasoned_conclusion("ЕХД", "Q2-2026", JUDGMENTS, RISKS)
    assert set(r1) == {"conclusion", "trace", "confidence", "llm"}
    assert r1["trace"]["stages"][0]["code"] == "E0"
    assert len(r1["trace"]["lenses"]) >= 3
    r2 = generate_reasoned_conclusion("ЕХД", "Q2-2026", JUDGMENTS, RISKS)
    assert r2 is r1  # кэш по входам


def test_training_block_contains_stage_trace():
    trace = run_reasoning(_inp(), use_llm=False)
    block = trace.as_training_block()
    assert "Постановка проблемы" in block
    assert "5 Почему" in block
    assert "Линза: Менеджер качества" in block
    assert "Хансей" in block
