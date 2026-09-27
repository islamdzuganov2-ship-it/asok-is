"""ИБ, пул 26.09.2026 (docs/BACKLOG_ИБ.md): Фаза 0 (ИБ-02/03/04/06), ИБ-11, ИБ-14.

Проверяется поведение, ради которого задача заведена, а не наличие строк в коде.
"""
from __future__ import annotations

import re
from pathlib import Path

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
