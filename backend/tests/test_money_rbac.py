"""Страж: деньги контура не отдаются роли без права `view.risk_economics` (ДЕФ-42).

Найдено ревью 2026-09-07. До фикса денежные чтения довольствовались аутентификацией
(`Depends(get_current_user)`), а RBAC на них держался только фронтом. Практический сценарий
эксплуатации не требовал даже curl: у роли EXECUTOR есть права на дашборды `dynamics`,
`incidents`, `risk_radar`, поэтому она могла добавить CTO-плитки кокпита на «Мой дашборд»
и получить бандл `/reports/cockpit?role=CTO` целиком — вместе с `managerMetrics`
(ΔALE по руководителям). При том что деньги исполнителю не показывают намеренно:
ТЗ v19 §17.8 (УК-58) явно оставляет `view.measure_economics.own` на усмотрение
суперадминистратора и НЕ выдаёт роли по умолчанию.

EXECUTOR — единственная роль без `view.risk_economics`, поэтому тесты держат именно её.
"""
import httpx
import pytest
from httpx import ASGITransport

from app.infrastructure.database import get_db
from app.main import app
from app.modules.iam import permissions_service as ps
from app.modules.iam.security import create_access_token

API = "/api/v1"

#: Денежные чтения: без права должны отдавать 403, а не данные.
MONEY_READS = [
    "/econ/dashboard",
    "/econ/acceptance-queue",
    "/econ/portfolio-trend",
    "/econ/manager-metrics",
    "/econ/rates",
    "/econ/benchmarks",
    "/risk-events/portfolio-summary",
    "/risk-events/chain",
    "/risk-events/heatmap-money-layer",
]


@pytest.fixture(autouse=True)
def _reset_perm_cache():
    ps.reset_cache()
    yield
    ps.reset_cache()


@pytest.fixture
async def aclient(db_session):
    async def _override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = _override_get_db
    transport = ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.pop(get_db, None)


def _token(role: str) -> str:
    return create_access_token(
        {"sub": "00000000-0000-0000-0000-0000000000ff", "role": role, "username": f"t_{role.lower()}"}
    )


def _auth(role: str) -> dict:
    return {"Authorization": f"Bearer {_token(role)}"}


@pytest.mark.parametrize("path", MONEY_READS)
async def test_executor_denied_money_reads(aclient, db_session, path):
    """EXECUTOR не получает денежные агрегаты контура — ни одним из путей."""
    await ps.seed_rbac_defaults(db_session)
    r = await aclient.get(f"{API}{path}", headers=_auth("EXECUTOR"))
    assert r.status_code == 403, f"{path} отдал {r.status_code}: {r.text[:200]}"


@pytest.mark.parametrize("path", MONEY_READS)
async def test_risk_manager_allowed_money_reads(aclient, db_session, path):
    """Роль с правом деньги по-прежнему читает — фикс не сломал легитимный доступ."""
    await ps.seed_rbac_defaults(db_session)
    r = await aclient.get(f"{API}{path}", headers=_auth("RISK_MANAGER"))
    assert r.status_code == 200, f"{path} отдал {r.status_code}: {r.text[:200]}"


async def test_executor_denied_ceo_cockpit_bundle(aclient, db_session):
    """Бандл CEO целиком денежный — исполнителю отказ."""
    await ps.seed_rbac_defaults(db_session)
    r = await aclient.get(f"{API}/reports/cockpit?role=CEO", headers=_auth("EXECUTOR"))
    assert r.status_code == 403


async def test_executor_cto_cockpit_bundle_without_money(aclient, db_session):
    """Бандл CTO отдаётся, но денежная часть обнулена: надёжность и триггеры — не деньги,
    а `managerMetrics` (ΔALE по руководителям) — деньги, и их быть не должно."""
    await ps.seed_rbac_defaults(db_session)
    r = await aclient.get(f"{API}/reports/cockpit?role=CTO", headers=_auth("EXECUTOR"))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["managerMetrics"] is None, "ΔALE по руководителям утёк исполнителю"
    # Неденежные разделы бандла остаются на месте — плитки надёжности и радара легитимны.
    assert "incidentAnalytics" in body
    assert "triggeredRisks" in body


async def test_cto_cockpit_bundle_keeps_money_for_entitled_role(aclient, db_session):
    """У роли с правом денежная часть бандла CTO сохраняется."""
    await ps.seed_rbac_defaults(db_session)
    r = await aclient.get(f"{API}/reports/cockpit?role=CTO", headers=_auth("CTO"))
    assert r.status_code == 200, r.text
    assert r.json()["managerMetrics"] is not None
