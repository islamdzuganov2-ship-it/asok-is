"""ИБ, пул 26.09.2026 (docs/BACKLOG_ИБ.md): Фаза 0 (ИБ-02/03/04/06), ИБ-11, ИБ-14.

Проверяется поведение, ради которого задача заведена, а не наличие строк в коде.
"""
from __future__ import annotations

import logging
import re
import sys
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient
from httpx import ASGITransport

from app.infrastructure.config import Settings, settings
from app.infrastructure.database import get_db
from app.main import app
from app.modules.iam import auth_service

API = "/api/v1/reports/llm-status"


# ═══════════════════ ИБ-14: CORS только для явного списка origin ═══════════════════

def _preflight(origin: str):
    with TestClient(app) as c:
        return c.options(API, headers={
            "Origin": origin, "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "authorization",
        })


def test_cors_allows_listed_origin():
    r = _preflight("http://localhost:3000")
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == "http://localhost:3000"
    assert "*" not in r.headers.get("access-control-allow-methods", "")


def test_cors_rejects_arbitrary_subdomain():
    """Прежний regex пропускал ЛЮБОЙ поддомен asokis.ai с учётными данными (SEC-13)."""
    for origin in ("https://evil.asokis.ai", "https://asokis.ai.evil.com", "https://attacker.example"):
        r = _preflight(origin)
        assert "access-control-allow-origin" not in r.headers, origin


def test_cors_wildcard_is_a_config_issue():
    s = Settings(CORS_ORIGINS=["*"], JWT_SECRET_KEY="x" * 40)
    assert any("CORS_ORIGINS" in i for i in s.security_issues())


# ═══════════════════ ИБ-03: безопасные версии зависимостей ═══════════════════

BACKEND = Path(__file__).resolve().parents[1]
MIN_SAFE = {"fastapi": (0, 109, 1), "python-jose": (3, 4, 0), "python-multipart": (0, 0, 31)}


def _pins(text: str) -> dict[str, tuple[int, ...]]:
    found = {}
    for name, version in re.findall(r"([a-z][a-z0-9-]+)(?:\[[a-z,]+\])?==([0-9.]+)", text):
        if name in MIN_SAFE:
            found[name] = tuple(int(x) for x in version.split("."))
    return found


def test_requirements_pin_safe_versions():
    """Пины и в requirements.txt, и в pyproject.toml: образ ставит оба (pip install -r и -e .),
    и расхождение даёт конфликт зависимостей, а уязвимую версию — «победившему» списку."""
    for fname in ("requirements.txt", "pyproject.toml"):
        pins = _pins((BACKEND / fname).read_text(encoding="utf-8"))
        assert set(pins) == set(MIN_SAFE), (fname, pins)
        for name, minimum in MIN_SAFE.items():
            assert pins[name] >= minimum, f"{fname}: {name} {pins[name]} ниже безопасной {minimum}"


# ═══════════════════ ИБ-02: демо-учётки только на демо-стенде ═══════════════════

REPO = BACKEND.parent


def test_demo_mode_is_off_by_default(monkeypatch):
    """Забытая переменная окружения = продуктивный режим, а не открытый демо-вход."""
    monkeypatch.delenv("DEMO_MODE", raising=False)
    assert Settings(_env_file=None).DEMO_MODE is False


def test_demo_users_hidden_outside_demo_mode(monkeypatch):
    monkeypatch.setattr(settings, "DEMO_MODE", False)
    assert auth_service.demo_users() == {}


def test_demo_users_store_only_bcrypt_hashes(monkeypatch):
    monkeypatch.setattr(settings, "DEMO_MODE", True)
    users = auth_service.demo_users()
    assert set(users) == {"superadmin", "admin", "analyst", "manager"}
    for u in users.values():
        assert "password" not in u
        assert u["password_hash"].startswith("$2b$")
    source = (BACKEND / "app/modules/iam/demo_users.py").read_text(encoding="utf-8")
    assert "Admin123!" not in source and "Super123!" not in source


def test_build_without_demo_module_starts_without_demo_login(monkeypatch, caplog):
    """Прод-образ собирается без demo_users.py (.dockerignore): вход не падает, демо-вход закрыт."""
    monkeypatch.setattr(settings, "DEMO_MODE", True)
    monkeypatch.setitem(sys.modules, "app.modules.iam.demo_users", None)  # имитация отсутствия
    with caplog.at_level(logging.WARNING, logger="app.modules.iam.auth_service"):
        assert auth_service.demo_users() == {}
    assert "демо-вход недоступен" in caplog.text


def test_prod_image_excludes_demo_credentials():
    ignored = {line.strip() for line in (BACKEND / ".dockerignore").read_text(encoding="utf-8").splitlines()}
    for path in ("app/modules/iam/demo_users.py", "app/scripts/seed_demo.py"):
        assert path in ignored, path


def test_env_example_defaults_to_prod():
    # В контейнере тестов корень репозитория смонтирован в /deploy (как docker-compose.yml).
    found = [p for p in (REPO / ".env.example", Path("/deploy/.env.example")) if p.is_file()]
    if not found:
        pytest.skip(".env.example вне смонтированных каталогов")
    env = found[0].read_text(encoding="utf-8")
    assert re.search(r"^DEMO_MODE=false\b", env, re.M)


@pytest.fixture
async def aclient(db_session):
    async def _override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = _override_get_db
    async with httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.pop(get_db, None)


async def test_demo_login_works_in_demo_mode(aclient, monkeypatch):
    monkeypatch.setattr(settings, "DEMO_MODE", True)
    r = await aclient.post("/api/v1/auth/login", json={"username": "analyst", "password": "Analyst123!"})
    assert r.status_code == 200, r.text
    assert r.json()["access_token"]


async def test_demo_login_rejects_wrong_password(aclient, monkeypatch):
    monkeypatch.setattr(settings, "DEMO_MODE", True)
    r = await aclient.post("/api/v1/auth/login", json={"username": "manager", "password": "wrong-password"})
    assert r.status_code == 401


async def test_demo_login_closed_outside_demo_mode(aclient, monkeypatch):
    monkeypatch.setattr(settings, "DEMO_MODE", False)
    r = await aclient.post("/api/v1/auth/login", json={"username": "manager", "password": "Manager123!"})
    assert r.status_code == 401
