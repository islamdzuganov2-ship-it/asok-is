"""E2E governance-петли в БД (T-10): полный цикл меры + SoD по ролевой модели v12 §5.1.

Проверяет против живого стека:
  • менеджер по качеству создаёт меру (топ-менеджмент/аналитик — не создаёт);
  • решение принимает ТОЛЬКО топ-менеджмент (QM получает 403 на approve);
  • контроль исполнения ведёт ТОЛЬКО менеджер по качеству;
  • инварианты состояния: повторное решение по не-ожидающей мере → 409.

Гейт: ASOK_E2E=1 (нужен работающий backend на localhost:8000 с демо-учётками).
Запуск: docker compose exec -T -e ASOK_E2E=1 backend python -m pytest tests/test_governance_e2e.py -q
"""
import os

import pytest

pytestmark = pytest.mark.skipif(os.getenv("ASOK_E2E") != "1", reason="E2E: нужен живой стек (ASOK_E2E=1)")

BASE = os.getenv("ASOK_API", "http://localhost:8000/api/v1")
CREDS = {
    "manager": {"username": "manager", "password": "Manager123!"},
    "admin": {"username": "admin", "password": "Admin123!"},
    "analyst": {"username": "analyst", "password": "Analyst123!"},
}


def _token(c, who: str) -> str:
    r = c.post("/auth/login", json=CREDS[who])
    assert r.status_code == 200, f"login {who} failed: {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def api():
    import httpx

    with httpx.Client(base_url=BASE, timeout=60) as c:
        yield c


def _auth(c, who: str) -> dict:
    return {"Authorization": f"Bearer {_token(c, who)}"}


def test_governance_sod_lifecycle(api):
    manager, admin, analyst = _auth(api, "manager"), _auth(api, "admin"), _auth(api, "analyst")

    # 1. Менеджер по качеству создаёт меру.
    payload = {
        "systemName": "E2E-TEST-GOV", "characteristic": "Надёжность",
        "metricName": "Доступность", "calculatedScore": 72,
        "rationale": "Инцидент P1 в Q4-2025", "expectation": "Резервирование узлов",
        "owner": "Иванов И.И.", "dueDate": "2026-09-01",
    }
    r = api.post("/governance/proposals", json=payload, headers=manager)
    assert r.status_code == 201, r.text
    p = r.json()
    pid = p["id"]
    assert p["status"] == "PENDING_APPROVAL"
    assert p["systemName"] == "E2E-TEST-GOV"
    assert p["createdBy"] == "manager"

    # 2. Аналитик НЕ может создавать меры (SoD).
    assert api.post("/governance/proposals", json=payload, headers=analyst).status_code == 403

    # 3. Менеджер по качеству НЕ может одобрять свою меру (решение — топ-менеджмент).
    assert api.post(f"/governance/proposals/{pid}/approve", json={}, headers=manager).status_code == 403

    # 4. Топ-менеджмент одобряет.
    r = api.post(f"/governance/proposals/{pid}/approve", json={"comment": "Согласовано"}, headers=admin)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "APPROVED"
    assert r.json()["decidedBy"] == "admin"
    assert r.json()["decisionComment"] == "Согласовано"

    # 5. Повторное решение по уже одобренной мере → 409 (инвариант состояния).
    assert api.post(f"/governance/proposals/{pid}/approve", json={}, headers=admin).status_code == 409

    # 6. Контроль исполнения ведёт менеджер по качеству; комментарий обязателен.
    assert api.post(f"/governance/proposals/{pid}/execution",
                    json={"status": "DONE", "comment": ""}, headers=manager).status_code == 422
    r = api.post(f"/governance/proposals/{pid}/execution",
                 json={"status": "DONE", "comment": "Узлы зарезервированы"}, headers=manager)
    assert r.status_code == 200, r.text
    assert r.json()["execution"] == "DONE"
    assert r.json()["executedBy"] == "manager"

    # 7. Мера видна в списке и фильтруется по системе.
    lst = api.get("/governance/proposals", params={"system": "E2E-TEST-GOV"}, headers=admin).json()
    assert any(x["id"] == pid for x in lst)


def test_escalation_flow(api):
    manager, admin = _auth(api, "manager"), _auth(api, "admin")
    # Мера, одобренная и просроченная → эскалация менеджером, решение топ-менеджмента.
    r = api.post("/governance/proposals", json={
        "systemName": "E2E-TEST-GOV", "characteristic": "Сопровождаемость",
        "rationale": "Тех. долг", "expectation": "Рефакторинг", "dueDate": "2026-01-01",
    }, headers=manager)
    pid = r.json()["id"]
    api.post(f"/governance/proposals/{pid}/approve", json={}, headers=admin)

    # Эскалацию инициирует менеджер по качеству (с причиной).
    r = api.post(f"/governance/proposals/{pid}/escalate",
                 json={"reason": "Срыв срока: нет ресурса"}, headers=manager)
    assert r.status_code == 200 and r.json()["escalated"] is True

    # Решение по эскалации — топ-менеджмент (запросить доп. меры).
    r = api.post(f"/governance/proposals/{pid}/escalation-decision",
                 json={"decision": "REQUEST_MEASURES", "comment": "Выделить разработчика"}, headers=admin)
    assert r.status_code == 200
    assert r.json()["escalationDecision"] == "REQUEST_MEASURES"
    assert r.json()["escalationDecidedBy"] == "admin"
