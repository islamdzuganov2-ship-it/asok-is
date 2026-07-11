"""E2E аналитики техсбоев (T-21) против живого стека: RBAC + аналитика.

  • менеджер по качеству заводит сбой; аналитик — не может (403, ведёт реестр QM);
  • чтение и аналитика доступны всем; аналитика возвращает агрегаты по категориям и MTTR.

Гейт: ASOK_E2E=1 (нужен backend на localhost:8000 с демо-учётками).
Запуск: docker compose exec -T -e ASOK_E2E=1 backend python -m pytest tests/test_incidents_e2e.py -q
"""
import os

import pytest

pytestmark = pytest.mark.skipif(os.getenv("ASOK_E2E") != "1", reason="E2E: нужен живой стек (ASOK_E2E=1)")

BASE = os.getenv("ASOK_API", "http://localhost:8000/api/v1")
CREDS = {
    "manager": {"username": "manager", "password": "Manager123!"},
    "analyst": {"username": "analyst", "password": "Analyst123!"},
}


@pytest.fixture(scope="module")
def api():
    import httpx

    with httpx.Client(base_url=BASE, timeout=60) as c:
        yield c


def _auth(c, who: str) -> dict:
    r = c.post("/auth/login", json=CREDS[who])
    assert r.status_code == 200, f"login {who}: {r.text}"
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_incident_rbac_and_analytics(api):
    manager, analyst = _auth(api, "manager"), _auth(api, "analyst")
    payload = {
        "systemName": "E2E-TEST-INC", "category": "RELEASE", "severity": "high",
        "title": "Регрессия после релиза", "rootCause": "Сломан контракт интеграции",
        "releaseRef": "APP 1.2.3", "occurredAt": "2026-05-01T10:00:00Z",
        "resolvedAt": "2026-05-01T14:00:00Z",
    }
    # Аналитик не ведёт реестр сбоев (SoD).
    assert api.post("/incidents", json=payload, headers=analyst).status_code == 403

    r = api.post("/incidents", json=payload, headers=manager)
    assert r.status_code == 201, r.text
    inc = r.json()
    assert inc["category"] == "RELEASE" and inc["createdBy"] == "manager"

    # Недопустимая категория → 422 (доменная валидация).
    bad = {**payload, "category": "UNKNOWN"}
    assert api.post("/incidents", json=bad, headers=manager).status_code == 422

    # Аналитика доступна и считает агрегаты.
    a = api.get("/incidents/analytics", params={"system": "E2E-TEST-INC"}, headers=analyst).json()
    assert a["total"] >= 1
    assert a["avgMttrHours"] is not None
    assert any(c["category"] == "RELEASE" for c in a["byCategory"])
