"""Тесты RBAC (BL-008): резолвер прав, каталог, матрица, enforcement, управление пользователями.

Используется АСИНХРОННЫЙ httpx-клиент (ASGITransport) в ТОМ ЖЕ event loop, что и `db_session`.
Синхронный TestClient крутит запрос в отдельном loop, из-за чего asyncpg-соединение тестовой
сессии делится между двумя циклами → InterfaceError; async-клиент это исключает и позволяет
свободно сеять данные через db_session и проверять их через API в одном тесте.

Резолвер держит процессный кэш — автоюз-фикстура сбрасывает его вокруг каждого теста.
"""
import httpx
import pytest
from httpx import ASGITransport

from app.infrastructure.database import get_db
from app.main import app
from app.modules.iam import User
from app.modules.iam import permissions_service as ps
from app.modules.iam.permissions import ADMIN_PERMISSIONS, ALL_PERMISSION_KEYS, DEFAULT_ROLE_PERMISSIONS
from app.modules.iam.security import create_access_token

API = "/api/v1"


@pytest.fixture(autouse=True)
def _reset_perm_cache():
    ps.reset_cache()
    yield
    ps.reset_cache()


@pytest.fixture
async def aclient(db_session):
    """Async-клиент к приложению с внедрённой тестовой сессией (единый event loop с db_session)."""
    async def _override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = _override_get_db
    transport = ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.pop(get_db, None)


async def _login(ac, username: str, password: str) -> str:
    r = await ac.post(f"{API}/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ═══════════════ Резолвер / сервис ═══════════════

async def test_resolver_superadmin_gets_all(db_session):
    await ps.seed_rbac_defaults(db_session)
    assert await ps.get_role_permissions(db_session, User.ROLE_SUPER_ADMIN) == ALL_PERMISSION_KEYS


async def test_resolver_role_defaults(db_session):
    await ps.seed_rbac_defaults(db_session)
    for role in ("TEST_ANALYST", "QUALITY_MANAGER", "RISK_MANAGER", "CTO"):
        assert set(await ps.get_role_permissions(db_session, role)) == DEFAULT_ROLE_PERMISSIONS[role], role


async def test_resolver_admin_is_builtin(db_session):
    # ADMIN — встроенная роль: широкий доступ мимо матрицы, но БЕЗ управления доступом.
    perms = await ps.get_role_permissions(db_session, User.ROLE_ADMIN)
    assert perms == ADMIN_PERMISSIONS
    assert "governance.decide" in perms and "admin.users.manage" not in perms


async def test_resolver_unknown_role_empty(db_session):
    await ps.seed_rbac_defaults(db_session)
    assert await ps.get_role_permissions(db_session, "NOPE") == frozenset()


async def test_seed_is_idempotent(db_session):
    assert await ps.seed_rbac_defaults(db_session) > 0
    assert await ps.seed_rbac_defaults(db_session) == 0  # повторно матрицу не дублирует


async def test_set_role_permissions_filters_and_persists(db_session):
    await ps.seed_rbac_defaults(db_session)
    saved = await ps.set_role_permissions(
        db_session, "TEST_ANALYST", ["view.reports", "assessment.edit", "bogus.key"])
    assert set(saved) == {"view.reports", "assessment.edit"}     # неизвестное право отброшено
    assert await ps.get_role_permissions(db_session, "TEST_ANALYST") == frozenset(saved)


async def test_set_role_permissions_rejects_builtin(db_session):
    await ps.seed_rbac_defaults(db_session)
    for role in ("ADMIN", "SUPER_ADMIN"):
        with pytest.raises(ps.BuiltinRoleError):
            await ps.set_role_permissions(db_session, role, [])


# ═══════════════ /me/permissions и enforcement ═══════════════

async def test_me_permissions_matches_defaults(aclient, db_session):
    await ps.seed_rbac_defaults(db_session)
    token = await _login(aclient, "analyst", "Analyst123!")
    r = await aclient.get(f"{API}/iam/me/permissions", headers=_auth(token))
    assert r.status_code == 200
    body = r.json()
    assert body["role"] == "TEST_ANALYST"
    assert set(body["permissions"]) == DEFAULT_ROLE_PERMISSIONS["TEST_ANALYST"]


async def test_enforcement_denies_without_permission(aclient, db_session):
    await ps.seed_rbac_defaults(db_session)
    token = await _login(aclient, "analyst", "Analyst123!")
    assert (await aclient.get(f"{API}/iam/users", headers=_auth(token))).status_code == 403


async def test_enforcement_allows_superadmin(aclient, db_session):
    await ps.seed_rbac_defaults(db_session)
    token = await _login(aclient, "superadmin", "Super123!")
    r = await aclient.get(f"{API}/iam/users", headers=_auth(token))
    assert r.status_code == 200 and any(u["username"] == "superadmin" for u in r.json())


async def test_enforcement_denies_econ_config_write(aclient, db_session):
    await ps.seed_rbac_defaults(db_session)
    token = await _login(aclient, "analyst", "Analyst123!")
    r = await aclient.put(f"{API}/econ/config/risk_appetite", headers=_auth(token), json={"value": 1})
    assert r.status_code == 403


# ═══════════════ Управление пользователями ═══════════════

async def test_user_crud_flow(aclient, db_session):
    await ps.seed_rbac_defaults(db_session)
    h = _auth(await _login(aclient, "superadmin", "Super123!"))
    created = await aclient.post(f"{API}/iam/users", headers=h,
                                 json={"username": "newbie", "password": "Newbie123!", "role": "TEST_ANALYST"})
    assert created.status_code == 201, created.text
    uid = created.json()["id"]

    assert (await aclient.post(f"{API}/iam/users", headers=h,
            json={"username": "newbie", "password": "Newbie123!", "role": "TEST_ANALYST"})).status_code == 409
    assert (await aclient.post(f"{API}/iam/users", headers=h,
            json={"username": "x", "password": "Xxxxxx1!", "role": "WIZARD"})).status_code == 422

    patched = await aclient.patch(f"{API}/iam/users/{uid}", headers=h, json={"role": "QUALITY_MANAGER"})
    assert patched.status_code == 200 and patched.json()["role"] == "QUALITY_MANAGER"

    assert (await aclient.post(f"{API}/iam/users/{uid}/reset-password", headers=h,
            json={"password": "Reset123!"})).status_code == 200
    assert await _login(aclient, "newbie", "Reset123!")

    assert (await aclient.delete(f"{API}/iam/users/{uid}", headers=h)).status_code == 200
    listed = (await aclient.get(f"{API}/iam/users", headers=h)).json()
    assert all(u["id"] != uid for u in listed)


async def test_cannot_delete_self(aclient, db_session):
    await ps.seed_rbac_defaults(db_session)
    h = _auth(await _login(aclient, "superadmin", "Super123!"))
    me = (await aclient.post(f"{API}/iam/users", headers=h,
          json={"username": "selfie", "password": "Selfie12!", "role": "ADMIN"})).json()
    self_token = create_access_token({"sub": me["id"], "role": "SUPER_ADMIN", "username": "selfie"})
    r = await aclient.delete(f"{API}/iam/users/{me['id']}", headers=_auth(self_token))
    assert r.status_code == 400


# ═══════════════ Матрица прав ═══════════════

async def test_matrix_edit_reflects_and_resets_cache(aclient, db_session):
    await ps.seed_rbac_defaults(db_session)
    su = _auth(await _login(aclient, "superadmin", "Super123!"))

    put = await aclient.put(f"{API}/iam/permissions/matrix/TEST_ANALYST", headers=su,
                            json={"permissions": ["assessment.edit", "view.reports"]})
    assert put.status_code == 200
    seen = (await aclient.get(f"{API}/iam/me/permissions",
            headers=_auth(await _login(aclient, "analyst", "Analyst123!")))).json()
    assert set(seen["permissions"]) == {"assessment.edit", "view.reports"}

    await aclient.put(f"{API}/iam/permissions/matrix/TEST_ANALYST", headers=su,
                      json={"permissions": ["view.reports"]})
    seen2 = (await aclient.get(f"{API}/iam/me/permissions",
             headers=_auth(await _login(aclient, "analyst", "Analyst123!")))).json()
    assert seen2["permissions"] == ["view.reports"]  # кэш сброшен → assessment.edit исчез


async def test_matrix_put_rejects_builtin_roles(aclient, db_session):
    await ps.seed_rbac_defaults(db_session)
    su = _auth(await _login(aclient, "superadmin", "Super123!"))
    for role in ("ADMIN", "SUPER_ADMIN"):
        r = await aclient.put(f"{API}/iam/permissions/matrix/{role}", headers=su, json={"permissions": []})
        assert r.status_code == 400, role


async def test_matrix_invalid_role_422(aclient, db_session):
    await ps.seed_rbac_defaults(db_session)
    su = _auth(await _login(aclient, "superadmin", "Super123!"))
    r = await aclient.put(f"{API}/iam/permissions/matrix/WIZARD", headers=su, json={"permissions": []})
    assert r.status_code == 422


async def test_catalog_lists_all_permissions(aclient, db_session):
    await ps.seed_rbac_defaults(db_session)
    su = _auth(await _login(aclient, "superadmin", "Super123!"))
    cat = (await aclient.get(f"{API}/iam/permissions/catalog", headers=su)).json()
    assert {p["key"] for p in cat["permissions"]} == set(ALL_PERMISSION_KEYS)
    assert set(cat["roles"]) == set(User.ALL_ROLES)


async def test_new_catalog_permission_reaches_populated_matrix(db_session):
    """Право, добавленное в каталог новым релизом, доезжает до уже наполненной матрицы.

    Регресс к ДЕФ-01: `systems.edit` добавили в каталог и в дефолты QUALITY_MANAGER, но
    `seed_rbac_defaults` сеял дефолты ТОЛЬКО в пустую матрицу — на живом стенде менеджер
    получил 403 на создание системы. Теперь досеиваются права, которых нет ни у одной роли.
    """
    from sqlalchemy import delete, select

    from app.modules.iam.models import RolePermission

    await ps.seed_rbac_defaults(db_session)          # первичное наполнение
    # Имитируем «старую» инсталляцию: права ещё не существовало в каталоге.
    await db_session.execute(delete(RolePermission).where(RolePermission.permission == "systems.edit"))
    await db_session.commit()
    ps.reset_cache()
    assert "systems.edit" not in await ps.get_role_permissions(db_session, "QUALITY_MANAGER")

    added = await ps.seed_rbac_defaults(db_session)  # запуск после релиза
    assert added > 0
    ps.reset_cache()
    assert "systems.edit" in await ps.get_role_permissions(db_session, "QUALITY_MANAGER")


async def test_seed_does_not_restore_permission_revoked_by_superadmin(aclient, db_session):
    """Осознанное решение суперадмина не перезатирается повторным сидом."""
    await ps.seed_rbac_defaults(db_session)
    su = _auth(await _login(aclient, "superadmin", "Super123!"))
    await aclient.put(f"{API}/iam/permissions/matrix/TEST_ANALYST", headers=su,
                      json={"permissions": ["view.reports"]})
    ps.reset_cache()

    await ps.seed_rbac_defaults(db_session)
    ps.reset_cache()
    perms = await ps.get_role_permissions(db_session, "TEST_ANALYST")
    assert perms == frozenset({"view.reports"}), "сид вернул снятые суперадмином права"


async def test_new_role_gets_full_default_set_in_populated_matrix(db_session):
    """Роль, появившаяся с релизом, получает ВЕСЬ свой дефолтный набор (ДЕФ-10).

    Регресс: досев умел добавлять только права, которых не было ни у одной роли. Роль
    EXECUTOR состоит в основном из прав, уже выданных другим ролям (дашборды), поэтому
    на живом стенде исполнителю досталось ровно одно право — `view.my_tasks` вместо
    полного набора, и меню у него было пустым.
    """
    from sqlalchemy import delete

    from app.modules.iam.models import RolePermission

    await ps.seed_rbac_defaults(db_session)
    await db_session.execute(delete(RolePermission).where(RolePermission.role == "EXECUTOR"))
    await db_session.commit()
    ps.reset_cache()
    assert await ps.get_role_permissions(db_session, "EXECUTOR") == frozenset()

    await ps.seed_rbac_defaults(db_session)
    ps.reset_cache()
    granted = await ps.get_role_permissions(db_session, "EXECUTOR")
    assert granted == frozenset(DEFAULT_ROLE_PERMISSIONS["EXECUTOR"])
    assert "view.dashboard.taskplan" in granted
    assert "governance.decide" not in granted, "исполнитель не принимает решений по мерам (SoD)"


def test_risk_base_not_default_for_top_management():
    """«База рисков» не выдаётся CTO/CEO по умолчанию (ДЕФ-17, T-06, БТ-036).

    Заказчик отменил этот пункт для топ-менеджмента: «не требуется для роли топ менеджер,
    не его уровень» (2026-07-06). Право продолжало доставаться им через общий набор
    _VIEW_COMMON, поэтому пункт меню оставался виден.
    """
    for role in ("CTO", "CEO"):
        assert "view.risks" not in DEFAULT_ROLE_PERMISSIONS[role], role
    # Тем, кто ведёт риски предметно, доступ остаётся.
    for role in ("QUALITY_MANAGER", "RISK_MANAGER", "AUDITOR", "TEST_ANALYST"):
        assert "view.risks" in DEFAULT_ROLE_PERMISSIONS[role], role
