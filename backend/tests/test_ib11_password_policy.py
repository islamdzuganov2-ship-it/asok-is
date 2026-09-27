"""ИБ-11 (docs/BACKLOG_ИБ.md): парольная политика и обязательная смена временного пароля.

Проверяется то, что до ИБ-11 было дырой: пароль «123456» принимался, пароль от администратора
оставался навсегда, к старому паролю можно было вернуться.
"""
import uuid

import httpx
import pytest
from httpx import ASGITransport
from sqlalchemy import select

from app.infrastructure.config import settings
from app.infrastructure.database import get_db
from app.main import app
from app.modules.iam import password_policy as pp
from app.modules.iam import permissions_service as ps
from app.modules.iam.models import AuditLog, User
from app.modules.iam.security import create_access_token, get_password_hash

API = "/api/v1"
STRONG = "Correct-Horse-9x"


# ═══════════════════ Правила политики ═══════════════════

@pytest.mark.parametrize("password", [
    "Aa1!",                       # короткий
    "alllowercaseletters",        # одна группа
    "lowercase-and-symbols",      # две группы
    "Password2026!",              # словарное слово + год
    "Qwerty123456!",              # клавиатурная последовательность
    "P@ssw0rd-1234",              # leetspeak
    "Aa!123456789012",            # почти одни цифры
    "Asok-Admin-2026",            # название системы + роль
])
def test_weak_passwords_rejected(password):
    assert pp.violations(password, "ivan")


def test_password_containing_login_rejected():
    assert pp.RULES[2] in pp.violations("Petrov-Secure-77x", "petrov")


@pytest.mark.parametrize("password", [STRONG, "Горный-ветер-7-Луна", "Brand-New-Pass-7", "tRiCky_Mango_Tree"])
def test_strong_passwords_accepted(password):
    assert pp.violations(password, "ivan") == []


def test_history_keeps_last_five_and_detects_reuse():
    hashes: list[str] = []
    passwords = [f"Orbit-Lantern-{i}x" for i in range(7)]
    for p in passwords:
        hashes = pp.push_history(hashes, get_password_hash(p))
    assert len(hashes) == pp.HISTORY_DEPTH
    assert pp.is_reused(passwords[-1], hashes) and pp.is_reused(passwords[2], hashes)
    assert not pp.is_reused(passwords[1], hashes)   # шестой с конца — уже вне истории
    with pytest.raises(pp.PasswordPolicyError, match="последних"):
        pp.ensure_acceptable(passwords[-2], "ivan", hashes)


# ═══════════════════ Сценарий: временный пароль → обязательная смена ═══════════════════

@pytest.fixture(autouse=True)
def _db_users_only(monkeypatch):
    monkeypatch.setattr(settings, "DEMO_MODE", False)   # вход по пользователям БД
    ps.reset_cache()
    yield
    ps.reset_cache()


@pytest.fixture
async def aclient(db_session):
    async def _override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = _override_get_db
    async with httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.pop(get_db, None)


def _bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
async def root(db_session):
    await ps.seed_rbac_defaults(db_session)
    return _bearer(create_access_token({"sub": str(uuid.uuid4()), "role": "SUPER_ADMIN", "username": "root"}))


async def _create(ac, root, username="ivan", password=STRONG):
    return await ac.post(f"{API}/iam/users", headers=root,
                         json={"username": username, "password": password, "role": "QUALITY_MANAGER"})


async def _login(ac, username="ivan", password=STRONG):
    return await ac.post(f"{API}/auth/login", json={"username": username, "password": password})


async def _change(ac, token, current, new):
    return await ac.post(f"{API}/auth/change-password", headers=_bearer(token),
                         json={"current_password": current, "new_password": new})


async def test_admin_cannot_set_weak_password(aclient, root):
    r = await _create(aclient, root, password="Newbie123!")
    assert r.status_code == 422
    assert "не короче 12 символов" in r.json()["detail"]


async def test_temporary_password_forces_change_before_any_work(aclient, db_session, root):
    created = await _create(aclient, root)
    assert created.status_code == 201, created.text
    assert created.json()["must_change_password"] is True

    login = await _login(aclient)
    assert login.status_code == 200 and login.json()["must_change_password"] is True
    temp = login.json()["access_token"]
    # С временным паролем закрыто всё, кроме смены пароля и выхода.
    r = await aclient.get(f"{API}/iam/me/permissions", headers=_bearer(temp))
    assert r.status_code == 403 and r.json()["detail"] == "PASSWORD_CHANGE_REQUIRED"

    assert (await _change(aclient, temp, "wrong-current-pass", "Velvet-Summit-84")).status_code == 400
    assert (await _change(aclient, temp, STRONG, "short1A!")).status_code == 422
    assert (await _change(aclient, temp, STRONG, STRONG)).status_code == 422      # тот же пароль

    changed = await _change(aclient, temp, STRONG, "Velvet-Summit-84")
    assert changed.status_code == 200, changed.text
    assert changed.json()["must_change_password"] is False
    fresh = changed.json()["access_token"]
    assert (await aclient.get(f"{API}/iam/me/permissions", headers=_bearer(fresh))).status_code == 200
    # Токен временного пароля после смены отозван.
    assert (await aclient.get(f"{API}/iam/me/permissions", headers=_bearer(temp))).status_code == 401

    user = (await db_session.execute(select(User).where(User.username == "ivan"))).scalar_one()
    await db_session.refresh(user)
    assert user.must_change_password is False and user.password_changed_at is not None
    assert len(user.password_history) == 2
    relogin = await _login(aclient, password="Velvet-Summit-84")
    assert relogin.status_code == 200 and relogin.json()["must_change_password"] is False

    events = (await db_session.execute(
        select(AuditLog).where(AuditLog.action == "user.password_change").order_by(AuditLog.created_at))).scalars().all()
    assert [e.outcome for e in events] == ["failure", "success"]
    assert all("Velvet" not in str(e.new_values) for e in events)


async def test_refresh_keeps_change_requirement(aclient, root):
    await _create(aclient, root)
    login = (await _login(aclient)).json()
    refreshed = await aclient.post(f"{API}/auth/refresh", json={"refresh_token": login["refresh_token"]})
    assert refreshed.status_code == 200 and refreshed.json()["must_change_password"] is True
    r = await aclient.get(f"{API}/iam/me/permissions", headers=_bearer(refreshed.json()["access_token"]))
    assert r.status_code == 403


async def test_logout_allowed_with_temporary_password(aclient, root):
    await _create(aclient, root)
    temp = (await _login(aclient)).json()["access_token"]
    assert (await aclient.post(f"{API}/auth/logout", headers=_bearer(temp))).status_code == 204


async def test_cannot_return_to_recent_password(aclient, root):
    await _create(aclient, root)
    temp = (await _login(aclient)).json()["access_token"]
    t1 = (await _change(aclient, temp, STRONG, "Velvet-Summit-84")).json()["access_token"]
    r = await _change(aclient, t1, "Velvet-Summit-84", STRONG)   # назад к временному
    assert r.status_code == 422 and "последних" in r.json()["detail"]


async def test_admin_reset_makes_password_temporary_again(aclient, db_session, root):
    uid = (await _create(aclient, root)).json()["id"]
    temp = (await _login(aclient)).json()["access_token"]
    await _change(aclient, temp, STRONG, "Velvet-Summit-84")
    # Сброс на недавний пароль — тоже нарушение политики.
    r = await aclient.post(f"{API}/iam/users/{uid}/reset-password", headers=root, json={"password": STRONG})
    assert r.status_code == 422
    r = await aclient.post(f"{API}/iam/users/{uid}/reset-password", headers=root, json={"password": "Maple-Crossing-61"})
    assert r.status_code == 200
    login = await _login(aclient, password="Maple-Crossing-61")
    assert login.json()["must_change_password"] is True


async def test_existing_users_are_not_forced(aclient, db_session):
    """Миграция 027 не заставляет менять пароли уже работающих пользователей."""
    db_session.add(User(username="old", password_hash=get_password_hash("legacy-pass"), role="CTO"))
    await db_session.commit()
    login = await _login(aclient, "old", "legacy-pass")
    assert login.status_code == 200 and login.json()["must_change_password"] is False


async def test_policy_rules_are_published(aclient):
    r = await aclient.get(f"{API}/auth/password-policy")
    assert r.status_code == 200 and r.json()["rules"] == list(pp.RULES)
