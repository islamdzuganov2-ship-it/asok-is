"""Ресурсные ограничители LLM: прогрев, потолок очереди, бюджет ожидания (ДЕФ-04, RES-03/05).

Замеры на живом стенде до исправления:
  · GET /api/v1/reports/llm-status         — таймаут 20 с (не отвечал вовсе);
  · GET /api/v1/reports/executive-dashboard — таймаут 120 с, фактически ~10 минут.
Причина: `is_available()` дёргал `_load_llm()`, то есть опрос статуса — его делает
переключатель «Моки ↔ LLM» на каждой загрузке страницы — запускал холодную загрузку
6962 МБ под глобальной блокировкой и подвешивал ВЕСЬ бэкенд, включая не-LLM эндпоинты.
Очередь к модели при этом была неограниченной: каждый ожидающий держал поток из пула
asyncio.to_thread.

После исправления те же вызовы: 0.015 с и 0.055 с.
"""
from __future__ import annotations

import threading
import time

import pytest

from app.infrastructure.config import settings
from app.modules.llm import service


@pytest.fixture(autouse=True)
def _reset_llm_state(monkeypatch):
    """Каждый тест начинает с чистого состояния сервиса."""
    monkeypatch.setattr(service, "_llm", None, raising=False)
    monkeypatch.setattr(service, "_load_attempted", False, raising=False)
    monkeypatch.setattr(service, "_warmup_thread", None, raising=False)
    monkeypatch.setattr(service, "_waiting", 0, raising=False)
    yield


def test_is_available_does_not_trigger_model_load(monkeypatch):
    """Ключевой инвариант: опрос статуса НЕ грузит веса."""
    called = {"load": False}

    def _spy():
        called["load"] = True
        return None

    monkeypatch.setattr(service, "_load_llm", _spy)
    assert service.is_available() is False
    assert not called["load"], (
        "is_available() инициировал загрузку модели — именно это подвешивало /llm-status"
    )


def test_model_info_reports_loading_and_queue(monkeypatch):
    """Фронт должен отличать «модель грузится» от «модели нет»."""
    monkeypatch.setattr(service, "is_loading", lambda: True)
    info = service.model_info()
    assert info["loading"] is True
    assert info["available"] is False
    assert info["queue_depth"] == 0


def test_complete_returns_none_while_loading(monkeypatch):
    """Пока идёт прогрев — честный fallback без ожидания весов."""
    monkeypatch.setattr(service, "is_loading", lambda: True)
    monkeypatch.setattr(service, "_load_llm", lambda: pytest.fail("не должно грузить во время прогрева"))
    assert service.complete("любой промпт") is None


def test_infer_slot_serialises_access():
    """Слот пропускает по одному — llama.cpp не потокобезопасен."""
    with service._InferSlot():
        assert service._infer_lock.locked()
    assert not service._infer_lock.locked()


def test_infer_slot_fails_fast_when_queue_is_full(monkeypatch):
    """Сверх потолка очереди — немедленный отказ, а не ожидание."""
    monkeypatch.setattr(settings, "LLM_MAX_WAITING", 0)
    with pytest.raises(service.LlmBusyError, match="очередь"):
        with service._InferSlot():
            pass


def test_infer_slot_gives_up_after_timeout(monkeypatch):
    """Ожидание освобождения модели ограничено бюджетом времени."""
    monkeypatch.setattr(settings, "LLM_QUEUE_TIMEOUT_S", 0.2)
    monkeypatch.setattr(settings, "LLM_MAX_WAITING", 4)

    holder_done = threading.Event()

    def _hold():
        with service._InferSlot():
            holder_done.wait(timeout=5)

    holder = threading.Thread(target=_hold, daemon=True)
    holder.start()
    time.sleep(0.05)
    try:
        started = time.monotonic()
        with pytest.raises(service.LlmBusyError, match="занята"):
            with service._InferSlot():
                pass
        waited = time.monotonic() - started
        assert waited < 2.0, f"ждали {waited:.2f} с вместо бюджета 0.2 с"
    finally:
        holder_done.set()
        holder.join(timeout=5)


def test_queue_depth_returns_to_zero_after_release(monkeypatch):
    """Счётчик ожидающих не течёт: после выхода из слота он обнуляется."""
    assert service.queue_depth() == 0
    with service._InferSlot():
        assert service.queue_depth() == 0  # владелец слота уже не «ожидающий»
    assert service.queue_depth() == 0


def test_warmup_is_noop_when_llm_disabled(monkeypatch):
    monkeypatch.setattr(settings, "LLM_ENABLED", False)
    service.warmup()
    assert service.is_loading() is False


def test_warmup_starts_background_thread_and_does_not_block(monkeypatch):
    """Прогрев не задерживает старт приложения."""
    monkeypatch.setattr(settings, "LLM_ENABLED", True)
    monkeypatch.setattr(settings, "LLM_WARMUP", True)
    release = threading.Event()

    def _slow_load():
        release.wait(timeout=5)
        return None

    monkeypatch.setattr(service, "_load_llm", _slow_load)
    started = time.monotonic()
    service.warmup()
    elapsed = time.monotonic() - started
    try:
        assert elapsed < 0.5, f"warmup() блокировал старт на {elapsed:.2f} с"
        assert service.is_loading() is True
    finally:
        release.set()
        if service._warmup_thread:
            service._warmup_thread.join(timeout=5)
