"""Юнит-тесты «резервного мозга» LLM (память/корпус/фидбэк вне модели, переносимо).

Каталог мозга изолирован в temp через autouse-фикстуру _isolate_llm_brain (conftest.py).
"""
import pytest

from app.modules.llm import brain


def test_remember_and_recall_roundtrip():
    fp = brain.remember({
        "system": "ЕХД", "period": "Q1-2026", "chars": ["Надёжность"],
        "problem": "просела надёжность", "root_cause": "нет резервирования узлов",
    })
    assert fp and len(fp) == 12
    block = brain.recall("ЕХД", ["Надёжность"])
    assert "ЕХД" in block
    assert "резервирования" in block


def test_recall_empty_without_relevant_memory():
    brain.remember({"system": "ЕХД", "period": "Q1", "chars": ["Надёжность"], "root_cause": "x"})
    assert brain.recall("Другая ИС", ["Совместимость"]) == ""


def test_reject_feedback_excludes_memory_from_recall():
    fp = brain.remember({
        "system": "ЕХД", "period": "Q1", "chars": ["Надёжность"], "root_cause": "нет резервирования",
    })
    brain.record_feedback(fp, "reject")
    assert brain.recall("ЕХД", ["Надёжность"]) == ""


def test_edit_feedback_adds_gold_example_to_corpus():
    fp = brain.fingerprint("ЕХД", "Q1")
    brain.record_feedback(fp, "edit", edited_text="Исправленное экспертом заключение")
    edits = brain.human_edits()
    assert any("Исправленное экспертом" in e["output"] for e in edits)


def test_invalid_verdict_raises():
    with pytest.raises(ValueError):
        brain.record_feedback("abc123", "maybe")


def test_stats_report_counts_and_dir():
    brain.remember({"system": "A", "period": "Q1", "chars": [], "root_cause": "x"})
    s = brain.stats()
    assert s["memories"] >= 1
    assert "dir" in s and "systems" in s


def test_profile_roundtrip_persists_overrides():
    p = brain.load_profile()
    p["overrides"]["temperature"] = 0.05
    brain.save_profile(p)
    assert brain.load_profile()["overrides"]["temperature"] == 0.05


def test_note_model_registers_in_meta():
    brain.note_model("Gemma 3 12B", "gemma3")
    brain.note_model("Gemma 3 12B", "gemma3")  # повторно → инкремент, не дубль
    s = brain.stats()
    assert s["models_seen"] == 1
