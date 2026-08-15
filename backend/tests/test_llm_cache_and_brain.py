"""Ограниченный кэш ответов и кэш статистики «мозга» (ДЕФ-21, ДЕФ-23 / RES-04, RES-07).

ДЕФ-21: `_cache` был обычным dict и очищался только при reload() — рос неограниченно,
каждое значение до LLM_MAX_TOKENS текста.

ДЕФ-23: `brain.stats()` читал ЧЕТЫРЕ файла с диска на каждый вызов, а вызывается он из
`GET /reports/llm-status`, который дёргает переключатель «Моки ↔ LLM» при каждой загрузке
страницы — синхронно, в event loop.
"""
from __future__ import annotations

import json
import os

import pytest

from app.modules.llm import brain
from app.modules.llm import service


@pytest.fixture(autouse=True)
def _clear_cache():
    service._cache.clear()
    yield
    service._cache.clear()


def test_cache_evicts_oldest_beyond_limit():
    limit = service._CACHE_MAX_ENTRIES
    for i in range(limit + 50):
        service._cache_put(i, f"ответ {i}")
    assert service.cache_size() == limit, "кэш вырос за установленный потолок"
    assert service._cache_get(0) is None, "самая давняя запись должна была вытесниться"
    assert service._cache_get(limit + 49) == f"ответ {limit + 49}"


def test_cache_get_refreshes_recency():
    """Использованная запись не вытесняется первой (LRU, а не FIFO)."""
    limit = service._CACHE_MAX_ENTRIES
    for i in range(limit):
        service._cache_put(i, f"ответ {i}")
    assert service._cache_get(0) == "ответ 0"      # освежили самую давнюю
    service._cache_put(10_000, "новый")            # вытеснение
    assert service._cache_get(0) == "ответ 0", "освежённая запись вытеснена как давняя"
    assert service._cache_get(1) is None


def test_cache_miss_returns_none():
    assert service._cache_get(123456) is None


def test_brain_stats_is_cached_between_calls(tmp_path, monkeypatch):
    monkeypatch.setattr(brain, "brain_dir", lambda: str(tmp_path))
    monkeypatch.setattr(brain, "_stats_cache", None, raising=False)

    (tmp_path / brain._MEMORY).write_text(
        json.dumps({"system": "АБС Core"}, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    reads = {"n": 0}
    original = brain._read_jsonl

    def _counting(name):
        reads["n"] += 1
        return original(name)

    monkeypatch.setattr(brain, "_read_jsonl", _counting)

    first = brain.stats()
    after_first = reads["n"]
    assert after_first > 0, "первый вызов обязан прочитать файлы"

    for _ in range(5):
        assert brain.stats() == first
    assert reads["n"] == after_first, (
        "повторные вызовы читали файлы заново — кэш по отпечатку не сработал"
    )


def test_brain_stats_recomputes_after_file_change(tmp_path, monkeypatch):
    monkeypatch.setattr(brain, "brain_dir", lambda: str(tmp_path))
    monkeypatch.setattr(brain, "_stats_cache", None, raising=False)

    memory = tmp_path / brain._MEMORY
    memory.write_text(json.dumps({"system": "А"}, ensure_ascii=False) + "\n", encoding="utf-8")
    assert brain.stats()["memories"] == 1

    with memory.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps({"system": "Б"}, ensure_ascii=False) + "\n")
    # Отпечаток учитывает размер файла, поэтому изменение видно даже при равном mtime.
    assert brain.stats()["memories"] == 2, "кэш не заметил изменения файла"


def test_brain_stats_survives_missing_files(tmp_path, monkeypatch):
    monkeypatch.setattr(brain, "brain_dir", lambda: str(tmp_path))
    monkeypatch.setattr(brain, "_stats_cache", None, raising=False)
    result = brain.stats()
    assert result["memories"] == 0 and result["corpus"] == 0 and result["feedback"] == 0
    assert os.path.basename(result["dir"]) == tmp_path.name
