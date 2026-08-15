"""Обход аутентификации разделён с демо-данными (ДЕФ-02).

Регресс: `get_current_user` при `DEMO_MODE=true` (значение по умолчанию) возвращал
пользователя `demo` с ролью ADMIN и для запроса БЕЗ токена, и для запроса с НЕВАЛИДНЫМ
токеном. Проверено на живом стенде 2026-08-15: `GET /api/v1/systems` с подписью
`eyJhbGciOiJIUzI1NiJ9.FORGED.SIG` возвращал 200 и реальные данные. Стенд публикуется
наружу туннелем, поэтому любой, кто знал адрес, получал администратора.

Инвариант теперь такой:
  · невалидный/просроченный токен — ВСЕГДА 401, независимо от режима;
  · обход только при DEMO_AUTH_BYPASS=true и только без заголовка Authorization;
  · DEMO_AUTH_BYPASS по умолчанию false и попадает в security_issues().
"""
import httpx
import pytest
from httpx import ASGITransport

from app.infrastructure.config import Settings, settings
from app.infrastructure.database import get_db
from app.main import app

API = "/api/v1"
FORGED = "eyJhbGciOiJIUzI1NiJ9.FORGED.SIG"


@pytest.fixture
async def aclient(db_session):
    async def _override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = _override_get_db
    transport = ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture
def bypass(monkeypatch):
    """Включить обход (как на демо-показе)."""
    monkeypatch.setattr(settings, "DEMO_AUTH_BYPASS", True)
    yield


def test_bypass_is_off_by_default():
    assert Settings().DEMO_AUTH_BYPASS is False


def test_bypass_is_reported_as_security_issue():
    s = Settings(DEMO_AUTH_BYPASS=True)
    assert any("DEMO_AUTH_BYPASS" in i for i in s.security_issues())
    assert not any("DEMO_AUTH_BYPASS" in i for i in Settings().security_issues())


async def test_no_token_is_rejected_without_bypass(aclient):
    r = await aclient.get(f"{API}/systems")
    assert r.status_code == 401


async def test_forged_token_is_rejected_without_bypass(aclient):
    r = await aclient.get(f"{API}/systems", headers={"Authorization": f"Bearer {FORGED}"})
    assert r.status_code == 401


async def test_forged_token_is_rejected_EVEN_WITH_bypass(aclient, bypass):
    """Ключевой инвариант: обход не распространяется на невалидную подпись."""
    r = await aclient.get(f"{API}/systems", headers={"Authorization": f"Bearer {FORGED}"})
    assert r.status_code == 401, "подделанный токен не должен повышаться до ADMIN"


async def test_anonymous_write_is_rejected_EVEN_WITH_bypass_for_forged_token(aclient, bypass):
    payload = {"name": "HACK", "code": "HACK", "criticality_class": "BUSINESS OPERATIONAL"}
    r = await aclient.post(f"{API}/systems", json=payload,
                           headers={"Authorization": f"Bearer {FORGED}"})
    assert r.status_code == 401


async def test_no_token_passes_when_bypass_enabled(aclient, bypass):
    """Показ стенда без логина продолжает работать, когда флаг включён осознанно."""
    r = await aclient.get(f"{API}/systems")
    assert r.status_code == 200
