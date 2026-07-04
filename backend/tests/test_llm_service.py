"""Юнит-тесты встроенной LLM: честный fallback и защита от галлюцинаций (grounding)."""
import app.modules.llm.service as llm


def setup_function():
    llm._cache.clear()


def test_allowed_pcts_extraction():
    assert llm._allowed_pcts("покрытие 25% и зрелость 80 %") == {"25", "80"}


def test_grounded_fallback_picks_worst_metric():
    block = "Тестируемость | покрытие | 25%\nНадёжность | uptime | 70%"
    out = llm._grounded_fallback("ЕХД", "Q2", block)
    assert "ЕХД" in out
    assert "25%" in out          # берётся самая просевшая метрика


def test_grounded_fallback_no_data():
    out = llm._grounded_fallback("ЕХД", "Q2", "")
    assert "данные отсутствуют" in out.lower()


def test_generate_summary_fallback_when_llm_unavailable(monkeypatch):
    monkeypatch.setattr(llm, "complete", lambda *a, **k: None)
    out = llm.generate_summary("ЕХД", "Q2", "Тестируемость | покрытие | 25%")
    assert "ЕХД" in out and len(out) > 20


def test_generate_summary_rejects_hallucinated_pct(monkeypatch):
    # LLM «придумала» 99%, которого нет во входе → ответ заменяется честным fallback
    monkeypatch.setattr(llm, "complete", lambda *a, **k: "Качество отличное, рост до 99%.")
    out = llm.generate_summary("ЕХД", "Q2", "Тестируемость | покрытие | 25%")
    assert "99%" not in out


def test_generate_summary_keeps_grounded_pct(monkeypatch):
    # Если все проценты ответа есть во входе — ответ принимается как есть
    monkeypatch.setattr(llm, "complete", lambda *a, **k: "Тестируемость на уровне 25%, требуется план. <END>")
    out = llm.generate_summary("ЕХД", "Q2", "Тестируемость | покрытие | 25%")
    assert "25%" in out
