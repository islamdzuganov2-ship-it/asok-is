"""ИБ, пул 26.09.2026 (docs/BACKLOG_ИБ.md): Фаза 0 (ИБ-02/03/04/06), ИБ-11, ИБ-14.

Проверяется поведение, ради которого задача заведена, а не наличие строк в коде.
"""
from __future__ import annotations

from fastapi.testclient import TestClient

from app.infrastructure.config import Settings
from app.main import app

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
