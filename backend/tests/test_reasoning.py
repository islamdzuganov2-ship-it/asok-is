"""Юнит-тесты конвейера многоаспектного аналитического рассуждения (BL-005, ISO 25010/38500).

Критерии приёмки:
  1) заключение — только после Э0–Э6, трасса аудируема;
  2) минимум 3 ролевые точки зрения;
  3) grounding сохранён: чисел вне входа нет, при нехватке данных — честная оговорка;
  4) есть блоки первопричины и саморефлексии;
  5) в user-facing выводе нет терминов управленческих методологий.
"""
import pytest

import app.modules.llm.service as llm
from app.modules.llm import reasoning, style_guide
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
    assert [s.code for s in trace.stages] == [
        "E0", "E1", "E2", "E2Q", "E3", "E4", "E5", "E6", "E7",
    ]
    assert trace.conclusion == trace.stage("E7").content
    assert trace.conclusion.strip()


# ─── Критерий 2: минимум 3 ролевые точки зрения ──────────────────────────────────────────

def test_minimum_three_lenses_applied():
    trace = run_reasoning(_inp(), use_llm=False)
    assert len(trace.lenses) >= 3
    assert all(lens.view.strip() for lens in trace.lenses)


def test_less_than_three_lenses_rejected():
    with pytest.raises(ValueError):
        run_reasoning(_inp(), use_llm=False, lens_codes=("CIO", "QUALITY"))


# ─── Критерий 3: контроль достоверности / grounding ─────────────────────────────────────────────────

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
    # контроль достоверности фиксирует отбраковку в трассе — деловым языком, не кодом этапа
    assert "Постановка проблемы" in trace.stage("E4").content


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
    # саморефлексия называет непереданные источники
    assert "карточки мер" in trace.stage("E6").content


# ─── Критерий 4: контракт заключения ЛПР (6 блоков) и обязательные этапы ─────────────

def test_conclusion_contract_sections_present():
    trace = run_reasoning(_inp(), use_llm=False)
    # Структура заключения соответствует схеме «Rule Engine → LLM»: Объяснение · Причины ·
    # Риски · Рекомендации (+ аудит: меры и оговорки).
    for block in ("Объяснение", "Причины", "Риски",
                  "Рекомендации", "Предлагаемые меры", "Уверенность и оговорки"):
        assert block in trace.conclusion, f"нет блока: {block}"
    # первопричина и рефлексия — из соответствующих этапов
    assert trace.stage("E2").content.split()[0] in trace.conclusion
    assert "Уверенность:" in trace.stage("E6").content


def test_measures_not_synthesized_without_sources(monkeypatch):
    # без карточек мер и рисков LLM про меры не спрашиваем — любой ответ был бы выдумкой.
    monkeypatch.setattr(llm, "complete",
                        lambda *a, **k: "МЕРЫ: внедрить новый стенд.\nЗАКЛЮЧЕНИЕ: всё в порядке.")
    trace = run_reasoning(_inp(risks_block="", measures_block=""))
    assert trace.stage("E5").fell_back
    assert "внедрить новый стенд" not in trace.stage("E5").content
    assert "отсутств" in trace.stage("E5").content.lower()
    # а заключение от LLM при этом принять можно
    assert trace.stage("E7").used_llm


def test_unanchored_generic_text_rejected(monkeypatch):
    # Родовой «менеджерский» трёп без привязки к фактам входа — не первопричина.
    generic = ("ПРОБЛЕМА: Для улучшения бизнеса нужно работать лучше.\n"
               "ПЕРВОПРИЧИНА: Необходимо повысить общую производительность процессов компании.")
    monkeypatch.setattr(llm, "complete", lambda *a, **k: generic)
    trace = run_reasoning(_inp())
    assert trace.stage("E1").fell_back and trace.stage("E2").fell_back
    assert "повысить общую производительность" not in trace.conclusion


def test_anchored_analysis_is_kept(monkeypatch):
    # Вывод, ссылающийся на факты входа (тестируемость из суждений), проходит якорную проверку.
    anchored = ("ПРОБЛЕМА: просела тестируемость, регресс выполняется вручную.\n"
                "ПЕРВОПРИЧИНА: не выделен ресурс на автотесты; данных для следующего «почему» нет.")
    monkeypatch.setattr(llm, "complete", lambda *a, **k: anchored)
    trace = run_reasoning(_inp())
    assert trace.stage("E1").used_llm and trace.stage("E2").used_llm


def test_degenerate_repetition_rejected(monkeypatch):
    # Зацикленный повтор («данных отсутствия данных отсутствия…») отбраковывается, а не идёт в заключение.
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


def test_measures_driven_reasoning_without_judgments():
    # Поток /reports/measures-analytics: карточки мер — первичный источник, суждений нет.
    cards_block = (
        "Сопровождаемость | мер: 2, ИС: 1, ср.балл: 25%\n"
        "ЕХД | Сопровождаемость | Низкое покрытие автотестами: регресс вручную "
        "(балл 25%, ответственный Иванов, срок 01.08.2026)"
    )
    trace = run_reasoning(
        ReasoningInput("ИТ-ландшафт банка", "текущий период",
                       judgments_block="", risks_block=RISKS, measures_block=cards_block),
        use_llm=False,
    )
    # блок фактов входа честно фиксирует: суждений нет, меры есть
    assert "Профессиональные суждения: данные отсутствуют" in trace.stage("E0").content
    assert "Карточки мер:" in trace.stage("E0").content
    # синтез мер собирает меры из карточек (источник есть — fallback не «отсутствуют»)
    assert "из карточек мер" in trace.stage("E5").content
    # меры — первичный источник → уверенность не «низкая»
    assert trace.confidence == "средняя"
    assert trace.conclusion.strip()


# ─── Высокоуровневый вход и датасет ──────────────────────────────────────────────────

def test_generate_reasoned_conclusion_shape_and_cache(monkeypatch):
    monkeypatch.setattr(llm, "complete", lambda *a, **k: None)
    r1 = generate_reasoned_conclusion("ЕХД", "Q2-2026", JUDGMENTS, RISKS)
    assert set(r1) == {"conclusion", "trace", "confidence", "llm", "fingerprint",
                       "persona", "decisions"}
    assert r1["trace"]["stages"][0]["code"] == "E0"
    assert len(r1["trace"]["lenses"]) >= 3
    r2 = generate_reasoned_conclusion("ЕХД", "Q2-2026", JUDGMENTS, RISKS)
    assert r2 is r1  # кэш по входам


def test_training_block_contains_stage_trace():
    trace = run_reasoning(_inp(), use_llm=False)
    block = trace.as_training_block()
    assert "Постановка проблемы" in block
    assert "Первопричина" in block
    assert "Линза: Менеджер качества" in block
    assert "Саморефлексия" in block


# ─── ТЗ v18: лестница «почему», уточняющие вопросы, персоны, матрицы решений ─────────

_LADDER = (
    "ПРОБЛЕМА: просела тестируемость, регресс выполняется вручную.\n"
    "ПЕРВОПРИЧИНА:\n"
    "ПОЧЕМУ-1: регресс выполняется вручную\n"
    "ПОЧЕМУ-2: нет автотестов на критичные сценарии\n"
    "ПОЧЕМУ-3: не выделен ресурс на автоматизацию\n"
    "ПОЧЕМУ-4: данных для следующего «почему» нет\n"
)


def test_why_ladder_counts_only_proven_steps():
    chain = reasoning.parse_why_chain(_LADDER, max_depth=5)
    # Ступень-заглушка «данных нет» лестницу завершает и в глубину не засчитывается.
    assert chain == ["регресс выполняется вручную",
                     "нет автотестов на критичные сценарии",
                     "не выделен ресурс на автоматизацию"]


def test_why_ladder_stops_on_numbering_gap():
    text = "ПОЧЕМУ-1: первая\nПОЧЕМУ-3: третья без второй"
    assert reasoning.parse_why_chain(text) == ["первая"]


def test_why_ladder_respects_persona_depth():
    text = "\n".join(f"ПОЧЕМУ-{i}: ступень {i}" for i in range(1, 6))
    assert len(reasoning.parse_why_chain(text, max_depth=3)) == 3
    assert len(reasoning.parse_why_chain(text, max_depth=5)) == 5


def test_why_ladder_tolerates_loose_formatting():
    text = "**ПОЧЕМУ 1** — не выделен ресурс\n2. что-то постороннее"
    assert reasoning.parse_why_chain(text) == ["не выделен ресурс"]


def test_why_depth_recorded_in_trace(monkeypatch):
    monkeypatch.setattr(llm, "complete", lambda *a, **k: _LADDER)
    trace = run_reasoning(_inp())
    assert trace.why_depth == 3
    assert "Управляемая первопричина (3-я ступень)" in trace.stage("E2").content


def test_deterministic_run_has_no_invented_why_depth():
    trace = run_reasoning(_inp(), use_llm=False)
    assert trace.why_depth == 0        # без модели ступени не выдумываются
    assert trace.stage("E2").fell_back


def test_qa_stage_asks_only_about_present_data():
    # Мер и истории нет, но есть риски и два суждения → вопросы только про них.
    trace = run_reasoning(_inp(measures_block="", history_block=""), use_llm=False)
    questions = " ".join(q.question for q in trace.questions)
    assert "рисков" in questions or "риск" in questions
    assert "прошлыми периодами" not in questions   # истории нет — спрашивать бессмысленно


def test_qa_stage_marks_unanswered_questions_honestly(monkeypatch):
    monkeypatch.setattr(llm, "complete", lambda *a, **k: None)
    trace = run_reasoning(_inp())
    assert trace.questions, "вопросы должны формироваться и без модели"
    assert all(not q.resolved for q in trace.questions)
    assert "данные отсутствуют" in trace.stage("E2Q").content


def test_qa_stage_records_answers(monkeypatch):
    def fake(prompt, system=None, max_tokens=None, temperature=None):
        if "ОТВЕТ-1" in prompt:
            return "ОТВЕТ-1: меры закрывают причину частично.\nОТВЕТ-2: риск подтверждается суждениями."
        return None
    monkeypatch.setattr(llm, "complete", fake)
    trace = run_reasoning(_inp())
    resolved = [q for q in trace.questions if q.resolved]
    assert resolved, "ответы модели должны попадать в трассу"
    assert trace.stage("E2Q").used_llm


def test_persona_changes_lenses_and_budget():
    top = run_reasoning(_inp(), use_llm=False, persona="TOP_MANAGER")
    quality = run_reasoning(_inp(), use_llm=False, persona="QUALITY_MANAGER")
    assert top.persona == "TOP_MANAGER" and quality.persona == "QUALITY_MANAGER"
    assert len(top.lenses) == 3 and len(quality.lenses) == 4
    assert {lens.code for lens in top.lenses} == {"CIO", "RISK", "QUALITY"}


def test_unknown_persona_falls_back_to_default():
    trace = run_reasoning(_inp(), use_llm=False, persona="НЕТ_ТАКОЙ")
    assert trace.persona == "QUALITY_MANAGER"


def test_principles_audit_only_for_top_manager():
    top = run_reasoning(_inp(), use_llm=False, persona="TOP_MANAGER")
    quality = run_reasoning(_inp(), use_llm=False, persona="QUALITY_MANAGER")
    assert top.principles_audit and "coverage" in top.principles_audit
    assert quality.principles_audit == {}


def test_decision_matrices_applied_and_exposed():
    trace = run_reasoning(
        _inp(severity="high", criticality="MISSION CRITICAL"), use_llm=False)
    assert trace.decisions["triage"]["tier"] == "правление"
    assert trace.decisions["triage"]["sla_days"] == 7
    assert "Решение (матрица)" in trace.conclusion
    assert "правление" in trace.conclusion


def test_decision_matrix_is_not_overridden_by_llm(monkeypatch):
    # Модель «предлагает» другой уровень решения — таблица остаётся источником истины.
    monkeypatch.setattr(llm, "complete",
                        lambda *a, **k: "ЗАКЛЮЧЕНИЕ: решение принимать не требуется.")
    trace = run_reasoning(_inp(severity="high", criticality="MISSION CRITICAL"))
    assert trace.decisions["triage"]["tier"] == "правление"
    assert "уровень — правление" in trace.conclusion


def test_trace_dict_carries_v18_fields():
    d = run_reasoning(_inp(), use_llm=False).to_dict()
    for key in ("persona", "why_chain", "why_depth", "questions", "decisions", "principles"):
        assert key in d, f"в трассе нет поля {key}"


# ─── Критерий 5: нет терминологии управленческих методологий в выводе ─────────────────

_FORBIDDEN_TERMS = ("Дао", "Тойота", "Генти", "Генбуцу", "Немаваси",
                    "Дзидока", "Кайдзен", "Хансей", "андон", "Пока-ёкэ")


def test_no_methodology_jargon_in_user_facing_output():
    trace = run_reasoning(_inp(), use_llm=False)
    surfaces = [trace.conclusion, *(s.title for s in trace.stages),
                *(s.content for s in trace.stages)]
    blob = "\n".join(surfaces)
    for term in _FORBIDDEN_TERMS:
        assert term not in blob, f"жаргон методологии просочился в вывод: {term}"


# ─── Критерий 6: нет инженерного жаргона (grounding/fallback/трасса/коды этапов) ──────
# 2026-08-16: реальный вывод конвейера показывал ЛПР «Grounding-контроль пройден»,
# «Этапы на детерминированном fallback: E1, E2, E2Q, E3», «LLM-вывод недоступен/отбракован» —
# слова эксплуатационной кухни вместо делового языка (см. style_guide.py). Проверяем именно
# на «худшем» сценарии — без данных и без модели, когда почти все этапы уходят в формальные
# правила методики: это тот самый случай, где жаргон раньше просачивался сильнее всего.

def test_no_engineering_jargon_when_pipeline_is_fully_deterministic():
    trace = run_reasoning(
        ReasoningInput(system_name="ИТ-ландшафт банка", period_label="текущий период",
                       rules_block="- [Критический уровень качества] интегральное качество "
                                   "0% ниже порога 41%", severity="high"),
        use_llm=False,
    )
    surfaces = [trace.conclusion, *(s.title for s in trace.stages),
                *(s.content for s in trace.stages)]
    blob = "\n".join(surfaces)
    leaked = style_guide.contains_jargon(blob)
    assert not leaked, f"инженерный жаргон просочился в вывод: {leaked}"


def test_no_engineering_jargon_across_all_personas():
    for code in ("TOP_MANAGER", "QUALITY_MANAGER", "RISK_MANAGER", "ANALYST", "AUDITOR", "EXECUTOR"):
        trace = run_reasoning(_inp(), use_llm=False, persona=code)
        leaked = style_guide.contains_jargon(trace.conclusion)
        assert not leaked, f"персона {code}: инженерный жаргон в заключении: {leaked}"


def test_style_rule_is_present_in_every_persona_prompt():
    # BASE_HONESTY — единственное место с правилами честности (personas.py); правило 7
    # (запрет инженерного жаргона) обязано попасть в промпт КАЖДОЙ персоны через него.
    from app.modules.llm import personas
    for pers in personas.PERSONAS.values():
        assert style_guide.STYLE_RULE_BLOCK in pers.system_prompt, (
            f"персона {pers.code}: в системном промпте нет правила делового языка")
