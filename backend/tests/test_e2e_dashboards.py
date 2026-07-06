"""E2E: сквозная проливка данных между дашбордами (запуск против живого стека).

Проверяет, что все дашборды читают ОДНИ И ТЕ ЖЕ таблицы (assessment_periods /
assessment_values / professional_judgments) и сходятся в цифрах независимо от роли:
  • /assessments/dashboard (аналитика + дашборд МК)   — последний период каждой ИС;
  • /reports/executive-dashboard (топ-менеджмент)     — те же ИС, тот же период (DEF-12/13);
  • /assessments/judgments-filled и judgments-status  — те же периоды и системы.

Гейт: ASOK_E2E=1 (нужен работающий backend на localhost:8000 и пересеянная БД).
Запуск: docker compose exec -T -e ASOK_E2E=1 backend python -m pytest tests/test_e2e_dashboards.py -q
"""
import os

import pytest

pytestmark = pytest.mark.skipif(os.getenv("ASOK_E2E") != "1", reason="E2E: нужен живой стек (ASOK_E2E=1)")

BASE = os.getenv("ASOK_API", "http://localhost:8000/api/v1")


@pytest.fixture(scope="module")
def client():
    import httpx

    with httpx.Client(base_url=BASE, timeout=60) as c:
        r = c.post("/auth/login", json={"username": "admin", "password": "Admin123!"})
        assert r.status_code == 200, f"login failed: {r.text}"
        token = r.json()["access_token"]
        c.headers["Authorization"] = f"Bearer {token}"
        yield c


def test_same_systems_on_all_dashboards(client):
    a = client.get("/assessments/dashboard").json()
    e = client.get("/reports/executive-dashboard").json()
    analytics_systems = {s["name"] for s in a.get("systemDetails", [])}
    executive_systems = set(e.get("yAxisLabels", []))
    assert analytics_systems, "нет данных в /assessments/dashboard"
    # ИС с классическими оценками совпадают между дашбордами МК/аналитика и топ-менеджмента.
    assert analytics_systems == executive_systems


def test_global_score_consistent(client):
    a = client.get("/assessments/dashboard").json()
    e = client.get("/reports/executive-dashboard").json()
    # Один источник (последний период каждой ИС) → интегральный балл совпадает (доли ↔ %).
    assert abs(a["globalHealthScore"] * 100 - e["globalHealthScore"]) < 1.0


def test_latest_period_is_q2_2026(client):
    # DEF-13: последний период — Q2-2026, а не лексикографический Q4-2025.
    statuses = client.get("/assessments/judgments-status").json()
    for s in statuses:
        assert s["period"] == "Q2-2026", f"уведомление по архивному периоду: {s}"


def test_judgments_linked_to_characteristic(client):
    # Суждения АОКИС содержат характеристику «Функциональная пригодность» (связь для карточки МК).
    items = client.get("/assessments/judgments-filled", params={"system_name": "АОКИС"}).json()
    assert items, "по АОКИС нет суждений"
    chars = {i["characteristic"] for i in items}
    assert "Функциональная пригодность" in chars
    # Каждое суждение несёт связку система+период+характеристика+подхарактеристика.
    for i in items:
        assert i["system_name"] == "АОКИС" and i["period"] and i["subcharacteristic"] and i["judgment_text"]


def test_crm_has_unfilled_judgments_for_notifications(client):
    # Сценарий: у CRM ОПК суждения заполнены частично → уведомление МК.
    statuses = client.get("/assessments/judgments-status").json()
    names = {s["system_name"] for s in statuses}
    assert "CRM ОПК" in names
    crm = next(s for s in statuses if s["system_name"] == "CRM ОПК")
    assert 0 < crm["filled"] < crm["total"]


def test_heatmap_uses_canonical_characteristics(client):
    a = client.get("/assessments/dashboard").json()
    e = client.get("/reports/executive-dashboard").json()
    # Обе теплокарты — канонические характеристики ISO 25010 (одна модель, одна таблица).
    assert set(e["xAxisLabels"]).issubset(set(a["xAxisLabels"]))
