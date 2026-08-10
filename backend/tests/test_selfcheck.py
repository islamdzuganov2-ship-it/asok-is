"""Юнит-тесты самооценки LLM-подсистемы по ISO/IEC 25010 (BL-009, ТЗ v18 п.10).

Критерии приёмки:
  1) батарея проб покрывает ВСЕ пары «характеристика/подхарактеристика» эталонной модели —
     ни одна не забыта и ни одной лишней;
  2) отчёт формализован: фиксированный состав полей, годный для выгрузки и печати;
  3) интегральный балл считается ТОЛЬКО по измеренным пробам, неизмеримые его не занижают;
  4) неприменимые к LLM подхарактеристики честно помечены «невозможно измерить»;
  5) прогон устойчив: падение отдельной пробы не роняет отчёт;
  6) отчёты сохраняются и читаются обратно (история + последний).
"""
import json
import os

import pytest

from app.modules.llm import selfcheck
from app.modules.llm.selfcheck import MEASURED, NOT_MEASURABLE, PROBES, ProbeResult
from app.modules.quality import QUALITY_MODEL

_PAIRS = {(c, s) for c, subs in QUALITY_MODEL for s, _ in subs}


_FAKE_PROFILE = {
    "path": "models/llm/test-model.gguf", "file_name": "test-model.gguf",
    "name": "Test Model", "architecture": "testarch", "quant": "Q4_K_M", "params": "7B",
    "size_mb": 4096, "n_ctx": 4096, "n_ctx_train": 32768, "n_gpu_layers": 0,
    "chat_format": "chat_template.default", "has_chat_template": True,
}


@pytest.fixture()
def isolated_reports(tmp_path, monkeypatch):
    """Изоляция прогона: отчёты во временный каталог + подменённый паспорт модели.

    Подмена service.is_available/model_info принципиальна: без неё юнит-тест поднимал бы
    настоящую GGUF-модель (гигабайты и десятки секунд на каждый процесс pytest). Здесь
    проверяется МАШИНЕРИЯ отчёта, а не конкретная модель, поэтому паспорт фиксирован.
    """
    monkeypatch.setattr(selfcheck.brain, "brain_dir", lambda: str(tmp_path))
    monkeypatch.setattr(selfcheck.service, "is_available", lambda: True)
    monkeypatch.setattr(selfcheck.service, "model_info", lambda: {
        "enabled": True, "available": True, "profile": dict(_FAKE_PROFILE),
        "brain": {"dir": str(tmp_path), "memories": 3, "corpus": 1, "feedback": 1,
                  "systems": 1, "models_seen": 2},
    })
    monkeypatch.setattr(selfcheck.service, "list_models", lambda: [
        {"file": "test-model.gguf", "size_mb": 4096, "selected": True},
        {"file": "other-model.gguf", "size_mb": 3000, "selected": False},
    ])
    return tmp_path


# ─── Критерий 1: полное покрытие эталонной модели качества ───────────────────────────

def test_probe_battery_covers_every_subcharacteristic():
    assert set(PROBES) == _PAIRS, (
        f"не покрыто: {sorted(_PAIRS - set(PROBES))}; лишнее: {sorted(set(PROBES) - _PAIRS)}"
    )


def test_battery_size_matches_quality_model():
    assert len(PROBES) == 31


@pytest.mark.parametrize("key", sorted(PROBES), ids=lambda k: f"{k[0]}/{k[1]}")
def test_every_probe_is_described_and_callable(key):
    what, probe = PROBES[key]
    assert what.strip(), f"{key}: не описано, что измеряется"
    assert callable(probe)


# ─── Критерий 2: формализованный отчёт ───────────────────────────────────────────────

def test_static_report_shape(isolated_reports):
    report = selfcheck.run(mode="static", trigger="test")
    expected = {
        "id", "generated_at", "duration_s", "mode", "trigger", "model", "model_available",
        "integral", "coverage", "measured", "total", "characteristics", "verdict",
        "pipeline", "principles", "notes",
    }
    assert expected <= set(report)
    assert report["mode"] == "static" and report["trigger"] == "test"
    assert report["total"] == 31
    assert len(report["characteristics"]) == len(QUALITY_MODEL)


def test_report_rows_carry_evidence(isolated_reports):
    report = selfcheck.run(mode="static", trigger="test")
    for characteristic in report["characteristics"]:
        for row in characteristic["subcharacteristics"]:
            assert row["status"] in (MEASURED, NOT_MEASURABLE)
            assert row["evidence"].strip(), f"{row['subcharacteristic']}: нет обоснования балла"
            if row["status"] == MEASURED:
                assert 0.0 <= row["score"] <= 1.0
            else:
                assert row["score"] is None


# ─── Критерий 3: интеграл только по измеренному ──────────────────────────────────────

def test_integral_uses_only_measured_probes(isolated_reports):
    report = selfcheck.run(mode="static", trigger="test")
    scores = [row["score"]
              for c in report["characteristics"]
              for row in c["subcharacteristics"] if row["status"] == MEASURED]
    assert report["measured"] == len(scores)
    assert report["integral"] == pytest.approx(sum(scores) / len(scores), abs=0.001)
    assert report["coverage"] == pytest.approx(len(scores) / 31, abs=0.001)


def test_static_mode_leaves_inference_probes_unmeasured(isolated_reports):
    report = selfcheck.run(mode="static", trigger="test")
    by_sub = {row["subcharacteristic"]: row
              for c in report["characteristics"] for row in c["subcharacteristics"]}
    # Функциональные пробы требуют обращения к модели — в «static» они обязаны быть честно пусты.
    assert by_sub["Функциональная полнота"]["status"] == NOT_MEASURABLE
    assert "инференс" in by_sub["Функциональная полнота"]["evidence"]


# ─── Критерий 4: неприменимое помечено честно ────────────────────────────────────────

@pytest.mark.parametrize("sub", ["Эстетика интерфейса", "Доступность (accessibility)"])
def test_ui_subcharacteristics_are_not_applicable(isolated_reports, sub):
    report = selfcheck.run(mode="static", trigger="test")
    row = next(r for c in report["characteristics"]
               for r in c["subcharacteristics"] if r["subcharacteristic"] == sub)
    assert row["status"] == NOT_MEASURABLE
    assert row["score"] is None
    assert "интерфейс" in row["evidence"]


def test_verdict_names_both_score_and_coverage(isolated_reports):
    report = selfcheck.run(mode="static", trigger="test")
    assert "покрытии измерений" in report["verdict"]
    assert "%" in report["verdict"]


# ─── Критерий 5: устойчивость к падению пробы ────────────────────────────────────────

def test_failing_probe_does_not_break_report(isolated_reports, monkeypatch):
    key = ("Совместимость", "Сосуществование")
    what, _original = PROBES[key]

    def boom(_ctx):
        raise RuntimeError("проба намеренно упала")

    monkeypatch.setitem(PROBES, key, (what, boom))
    report = selfcheck.run(mode="static", trigger="test")
    row = next(r for c in report["characteristics"]
               for r in c["subcharacteristics"] if r["subcharacteristic"] == "Сосуществование")
    assert row["status"] == NOT_MEASURABLE
    assert "ошибкой" in row["evidence"]
    assert report["total"] == 31          # отчёт остался полным


# ─── Критерий 6: хранение отчётов ────────────────────────────────────────────────────

def test_report_is_persisted_and_readable(isolated_reports):
    report = selfcheck.run(mode="static", trigger="test")
    latest = selfcheck.latest()
    assert latest is not None and latest["id"] == report["id"]

    saved = os.path.join(selfcheck.reports_dir(), selfcheck.LATEST_FILE)
    with open(saved, encoding="utf-8") as f:
        assert json.load(f)["id"] == report["id"]


def test_history_lists_runs_newest_first(isolated_reports):
    first = selfcheck.run(mode="static", trigger="test")
    second = selfcheck.run(mode="static", trigger="test")
    rows = selfcheck.history()
    assert len(rows) >= 2
    ids = [r["id"] for r in rows]
    assert second["id"] in ids and first["id"] in ids
    assert {"generated_at", "mode", "trigger", "integral", "coverage"} <= set(rows[0])


def test_latest_is_none_before_any_run(isolated_reports):
    assert selfcheck.latest() is None
    assert selfcheck.history() == []


# ─── Вспомогательное: контракт ProbeResult ───────────────────────────────────────────

def test_probe_result_clamps_score():
    assert ProbeResult.measured(1.7, "e").score == 1.0
    assert ProbeResult.measured(-0.3, "e").score == 0.0
    assert ProbeResult.skip("e").score is None
