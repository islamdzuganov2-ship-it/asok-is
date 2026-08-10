"""Юнит-тесты чек-листа управленческих принципов и матрицы конвейера (BL-009, ТЗ v18 п.1, 5).

Критерии приёмки:
  1) принципов ровно 14, у каждого — проверочный вопрос и лексические признаки;
  2) ни чек-лист, ни каталог принципов НЕ выносят в текст названия управленческих школ
     (решение код-ревью 2026-07-06 §D-1, тот же инвариант, что у конвейера рассуждения);
  3) пост-проверка отражения принципов честно различает наличие и отсутствие темы;
  4) матрица конвейера описывает реально существующие модули и этапы;
  5) непрерывного дообучения весов в рантайме НЕТ — и это проверяется, а не декларируется.
"""
import os

import pytest

from app.modules.llm import pipeline, principles
from app.modules.llm.principles import PRINCIPLES, audit, checklist_block, prompt_coverage
from app.modules.llm.reasoning import STAGES

_FORBIDDEN_TERMS = ("Дао", "Тойота", "Toyota", "Генти", "Генбуцу", "Немаваси",
                    "Дзидока", "Кайдзен", "Хансей", "андон", "Пока-ёкэ")


# ─── Критерий 1: состав чек-листа ────────────────────────────────────────────────────

def test_exactly_fourteen_principles():
    assert len(PRINCIPLES) == 14


def test_principle_codes_are_unique_and_ordered():
    codes = [p.code for p in PRINCIPLES]
    assert codes == sorted(codes)
    assert len(set(codes)) == len(codes)


@pytest.mark.parametrize("principle", PRINCIPLES, ids=[p.code for p in PRINCIPLES])
def test_principle_is_fully_specified(principle):
    assert principle.title.strip()
    assert principle.question.strip().endswith("?")
    assert principle.markers, f"{principle.code}: нет лексических признаков для пост-проверки"


def test_prompt_checklist_is_not_empty():
    in_prompt = [p for p in PRINCIPLES if p.in_prompt]
    assert len(in_prompt) >= 5, "чек-лист промпта выродился — резюме нечем проверять"


# ─── Критерий 2: нет жаргона методологий в пользовательских поверхностях ─────────────

def test_checklist_block_has_no_methodology_jargon():
    block = checklist_block()
    for term in _FORBIDDEN_TERMS:
        assert term not in block, f"жаргон методологии в промпте: {term}"


def test_catalog_has_no_methodology_jargon():
    blob = "\n".join(f"{row['title']} {row['question']}" for row in principles.catalog())
    for term in _FORBIDDEN_TERMS:
        assert term not in blob, f"жаргон методологии в каталоге: {term}"


# ─── Критерий 3: пост-проверка отражения принципов ───────────────────────────────────

def test_audit_detects_absence_on_empty_text():
    result = audit("")
    assert result["coverage"] == 0.0
    assert len(result["missing"]) == 14
    assert result["covered"] == []


def test_audit_detects_reflected_topics():
    text = ("Просела тестируемость; первопричина — не выделен ресурс. Требуется решение "
            "руководства: закрепить меру регламентом, срок — следующий период, "
            "контроль по показателю покрытия.")
    result = audit(text)
    assert result["coverage"] > 0.4
    assert "P05" in result["covered"]   # устранение в источнике
    assert "P09" in result["covered"]   # решение уровня руководителя


def test_audit_shape_is_stable():
    result = audit("любой текст")
    assert set(result) == {"covered", "missing", "coverage", "details"}
    assert len(result["details"]) == 14
    assert len(result["covered"]) + len(result["missing"]) == 14


def test_prompt_coverage_is_bounded():
    assert prompt_coverage("") == 0.0
    assert 0.0 <= prompt_coverage("частичный текст про срок и контроль") <= 1.0


# ─── Критерий 4: матрица конвейера описывает реальность ──────────────────────────────

def test_matrix_levels_are_known():
    for source in pipeline.MATRIX:
        assert source.level in pipeline.LEVELS, f"{source.code}: неизвестный уровень обучения"


def test_matrix_feeds_reference_existing_stages():
    known = {code for code, _ in STAGES} | {"—"}
    for source in pipeline.MATRIX:
        unknown = set(source.feeds) - known
        assert not unknown, f"{source.code}: ссылки на несуществующие этапы {unknown}"


def test_matrix_modules_exist_on_disk():
    # Матрица — описание реализации, а не намерений: указанные файлы обязаны существовать.
    # Пути в матрице заданы относительно пакета `app` (например, "modules/llm/brain.py").
    llm_dir = os.path.dirname(os.path.abspath(pipeline.__file__))   # …/app/modules/llm
    app_dir = os.path.dirname(os.path.dirname(llm_dir))             # …/app
    checked = 0
    for source in pipeline.MATRIX:
        for ref in source.module.split(","):
            ref = ref.strip()
            if not ref.endswith(".py"):
                continue        # ссылки на документацию проверяются отдельно
            path = os.path.join(app_dir, *ref.split("/"))
            assert os.path.isfile(path), f"{source.code}: модуль не найден — {path}"
            checked += 1
    assert checked >= 8, "проверка выродилась: в матрице почти нет ссылок на модули"


def test_matrix_codes_are_unique():
    codes = [s.code for s in pipeline.MATRIX]
    assert len(set(codes)) == len(codes)


def test_rag_mechanism_is_described():
    summary = pipeline.summary()
    assert summary["rag_mechanism"].strip()
    assert summary["active_count"] >= 5


# ─── Критерий 5: дообучения весов в рантайме нет ─────────────────────────────────────

def test_no_continuous_finetuning_in_runtime():
    assert pipeline.continuous_finetuning_enabled() is False


def test_weight_changing_level_is_declared_offline():
    assert pipeline.LEVELS[pipeline.LEVEL_C]["weights_change"] is True
    assert pipeline.LEVELS[pipeline.LEVEL_C]["runtime"] is False


def test_runtime_levels_do_not_change_weights():
    for level in pipeline.LEVELS.values():
        if level["runtime"]:
            assert level["weights_change"] is False, (
                f"уровень {level['code']} объявлен рантайм-уровнем и меняющим веса — "
                "это и означало бы непрерывное дообучение"
            )
