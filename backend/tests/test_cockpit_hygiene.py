"""Гигиена кокпита (ТЗ-21 §9.1, КП-43): признак демо-данных бэкенда для плашки над плитками.

Плитки кокпита читают бэкенд всегда, независимо от клиентского тумблера «Демо/LLM». Поэтому
плашка «Демонстрационные данные» опирается на признак бэкенда `demo_data` (= DEMO_MODE),
а не на тумблер: иначе на демо-стенде с выключенным тумблером суммы в рублях выглядели бы
как настоящие.
"""
import httpx
from httpx import ASGITransport

from app.infrastructure.config import settings
from app.main import app
from app.modules.iam.security import create_access_token


def _auth(role: str) -> dict:
    token = create_access_token({"sub": "00000000-0000-0000-0000-0000000000fd", "role": role, "username": "t"})
    return {"Authorization": f"Bearer {token}"}


async def _status(role: str) -> dict:
    async with httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        r = await ac.get("/api/v1/reports/llm-status", headers=_auth(role))
    assert r.status_code == 200, r.text
    return r.json()


async def test_llm_status_carries_demo_data_flag(monkeypatch):
    monkeypatch.setattr(settings, "DEMO_MODE", True)
    assert (await _status("CEO"))["demo_data"] is True
    monkeypatch.setattr(settings, "DEMO_MODE", False)
    assert (await _status("CEO"))["demo_data"] is False


async def test_llm_status_still_describes_model():
    """Новое поле добавлено, прежний контракт индикатора LLM не сломан."""
    body = await _status("EXECUTOR")
    assert "available" in body and "profile" in body
