"""ИБ-Ф1 (docs/BACKLOG_ИБ.md): журнал событий ИБ, анти-брутфорс, отзыв токенов, заголовки,
пароль Redis, маскирование ПДн в логах.

Каждый блок проверяет то, что до Ф1 было дырой, а не «что код вызывается»:
  • ИБ-08 — после входа/отказа/смены прав в audit_log есть строка, и её нельзя изменить;
  • ИБ-10 — шестая попытка подбора получает 429 даже с ВЕРНЫМ паролем;
  • ИБ-12 — после выхода, смены роли и кражи refresh старые токены не принимаются;
  • ИБ-13 — ответы API несут заголовки, HSTS только для HTTPS;
  • ИБ-09 — ПДн и секреты маскируются в готовой строке лога;
  • пароль Redis — прод без пароля не стартует.
"""
import logging
import uuid

import httpx
import pytest
from httpx import ASGITransport
from sqlalchemy import select, text

from app.infrastructure.config import Settings, settings
from app.infrastructure.database import get_db
from app.infrastructure.logging_config import PiiMaskingFilter, mask_sensitive
from app.infrastructure.request_context import resolve_client_ip
from app.infrastructure.security_headers import headers_for
from app.main import app
from app.modules.iam import permissions_service as ps
from app.modules.iam.models import AuditLog, User
from app.modules.iam.security import create_access_token, create_refresh_token, get_password_hash

API = "/api/v1"


@pytest.fixture(autouse=True)
def _no_demo_users(monkeypatch):
    # Встроенные демо-учётки проверяются ПЕРВЫМИ — тесты входа идут по пользователям БД.
    monkeypatch.setattr(settings, "DEMO_MODE", False)
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


async def _user(db, username="ivan", password="Correct-Horse-9", role="QUALITY_MANAGER", active=True) -> User:
    u = User(username=username, password_hash=get_password_hash(password), role=role,
             full_name="Иванов Иван Иванович", is_active=active)
    db.add(u)
    await db.commit()
    await db.refresh(u)
    return u


async def _login(ac, username="ivan", password="Correct-Horse-9"):
    return await ac.post(f"{API}/auth/login", json={"username": username, "password": password})


def _bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _events(db, action: str | None = None) -> list[AuditLog]:
    q = select(AuditLog).order_by(AuditLog.created_at)
    if action:
        q = q.where(AuditLog.action == action)
    return list((await db.execute(q)).scalars().all())


# ═══════════════ ИБ-08: журнал событий ИБ ═══════════════

async def test_successful_login_is_audited_with_context(aclient, db_session):
    u = await _user(db_session)
    r = await aclient.post(f"{API}/auth/login", json={"username": "ivan", "password": "Correct-Horse-9"},
                           headers={"User-Agent": "pytest-agent", "X-Request-ID": "req-abc-12345"})
    assert r.status_code == 200, r.text
    ev = await _events(db_session, "auth.login")
    assert len(ev) == 1
    assert ev[0].user_id == u.id and ev[0].username == "ivan" and ev[0].outcome == "success"
    assert ev[0].user_agent == "pytest-agent"
    assert ev[0].request_id == "req-abc-12345"
    await db_session.refresh(u)
    assert u.last_login is not None


async def test_failed_login_is_audited_without_password(aclient, db_session):
    await _user(db_session)
    r = await _login(aclient, password="wrong-password-1")
    assert r.status_code == 401
    ev = await _events(db_session, "auth.login_failed")
    assert len(ev) == 1 and ev[0].outcome == "failure"
    assert ev[0].new_values == {"reason": "bad_password"}
    assert "wrong-password-1" not in str(ev[0].new_values)


async def test_audit_log_is_append_only(aclient, db_session):
    await _user(db_session)
    await _login(aclient)
    with pytest.raises(Exception, match="append-only"):
        await db_session.execute(text("UPDATE audit_log SET action = 'x'"))
    await db_session.rollback()
    with pytest.raises(Exception, match="append-only"):
        await db_session.execute(text("DELETE FROM audit_log"))
    await db_session.rollback()


async def test_matrix_change_is_audited_with_diff(aclient, db_session):
    await ps.seed_rbac_defaults(db_session)
    token = create_access_token({"sub": str(uuid.uuid4()), "role": "SUPER_ADMIN", "username": "root"})
    before = set(await ps.get_role_permissions(db_session, "EXECUTOR"))
    new = sorted(before | {"view.risks"})
    r = await aclient.put(f"{API}/iam/permissions/matrix/EXECUTOR", json={"permissions": new}, headers=_bearer(token))
    assert r.status_code == 200, r.text
    ev = await _events(db_session, "rbac.matrix_change")
    assert len(ev) == 1 and ev[0].entity_key == "EXECUTOR"
    assert ev[0].new_values == {"added": ["view.risks"]} and ev[0].username == "root"


async def test_audit_log_endpoint_is_superadmin_only(aclient, db_session):
    await ps.seed_rbac_defaults(db_session)
    await _user(db_session)
    await _login(aclient)
    sa = create_access_token({"sub": str(uuid.uuid4()), "role": "SUPER_ADMIN", "username": "root"})
    admin = create_access_token({"sub": str(uuid.uuid4()), "role": "ADMIN", "username": "adm"})
    r = await aclient.get(f"{API}/iam/audit-log", headers=_bearer(sa))
    assert r.status_code == 200 and r.json()[0]["action"] == "auth.login"
    assert (await aclient.get(f"{API}/iam/audit-log", headers=_bearer(admin))).status_code == 403


# ═══════════════ ИБ-10: анти-брутфорс ═══════════════

async def test_bruteforce_locks_pair_even_for_correct_password(aclient, db_session, monkeypatch):
    monkeypatch.setattr(settings, "LOGIN_MAX_FAILURES", 5)
    await _user(db_session)
    for _ in range(5):
        assert (await _login(aclient, password="guess")).status_code == 401
    r = await _login(aclient)   # верный пароль
    assert r.status_code == 429
    assert int(r.headers["Retry-After"]) > 0
    assert len(await _events(db_session, "auth.login_locked")) >= 1


async def test_lockout_is_per_login_case_insensitive(aclient, db_session, monkeypatch):
    monkeypatch.setattr(settings, "LOGIN_MAX_FAILURES", 3)
    await _user(db_session)
    for name in ("ivan", "IVAN", " Ivan "):
        await _login(aclient, username=name, password="guess")
    assert (await _login(aclient)).status_code == 429


async def test_success_resets_pair_counter(aclient, db_session, monkeypatch):
    monkeypatch.setattr(settings, "LOGIN_MAX_FAILURES", 3)
    await _user(db_session)
    for _ in range(2):
        await _login(aclient, password="guess")
    assert (await _login(aclient)).status_code == 200
    for _ in range(2):
        await _login(aclient, password="guess")
    assert (await _login(aclient)).status_code == 200   # счётчик начат заново


async def test_second_lockout_is_longer(monkeypatch):
    from app.modules.iam import throttle
    monkeypatch.setattr(settings, "LOGIN_MAX_FAILURES", 1)
    monkeypatch.setattr(settings, "LOGIN_LOCKOUT_S", 100)
    first = await throttle.register_failure("petr", "10.0.0.1")
    second = await throttle.register_failure("petr", "10.0.0.2")
    assert 90 <= first.retry_after <= 100
    assert second.retry_after > 150   # вторая блокировка за сутки — вдвое дольше


# ═══════════════ ИБ-12: сессии ═══════════════

async def test_logout_revokes_access_token(aclient, db_session):
    await ps.seed_rbac_defaults(db_session)
    await _user(db_session)
    tokens = (await _login(aclient)).json()
    h = _bearer(tokens["access_token"])
    assert (await aclient.get(f"{API}/iam/me/permissions", headers=h)).status_code == 200
    assert (await aclient.post(f"{API}/auth/logout", json={"refresh_token": tokens["refresh_token"]}, headers=h)).status_code == 204
    assert (await aclient.get(f"{API}/iam/me/permissions", headers=h)).status_code == 401
    # Refresh той же сессии тоже мёртв — выход не оставляет «запасного ключа».
    assert (await aclient.post(f"{API}/auth/refresh", json={"refresh_token": tokens["refresh_token"]})).status_code == 401
    assert len(await _events(db_session, "auth.logout")) == 1


async def test_refresh_rotation_and_reuse_detection(aclient, db_session):
    await ps.seed_rbac_defaults(db_session)
    await _user(db_session)
    first = (await _login(aclient)).json()
    r1 = await aclient.post(f"{API}/auth/refresh", json={"refresh_token": first["refresh_token"]})
    assert r1.status_code == 200
    rotated = r1.json()
    assert rotated["refresh_token"] != first["refresh_token"]
    # Повтор уже использованного refresh = кража: отказ и отзыв всей сессии.
    assert (await aclient.post(f"{API}/auth/refresh", json={"refresh_token": first["refresh_token"]})).status_code == 401
    assert (await aclient.get(f"{API}/iam/me/permissions", headers=_bearer(rotated["access_token"]))).status_code == 401
    assert (await aclient.post(f"{API}/auth/refresh", json={"refresh_token": rotated["refresh_token"]})).status_code == 401
    assert len(await _events(db_session, "auth.refresh_reuse")) == 1


async def test_refresh_denied_for_blocked_user(aclient, db_session):
    u = await _user(db_session)
    tokens = (await _login(aclient)).json()
    u.is_active = False
    await db_session.commit()
    assert (await aclient.post(f"{API}/auth/refresh", json={"refresh_token": tokens["refresh_token"]})).status_code == 401


async def test_role_change_forces_relogin(aclient, db_session):
    await ps.seed_rbac_defaults(db_session)
    u = await _user(db_session)
    victim = (await _login(aclient)).json()["access_token"]
    root = create_access_token({"sub": str(uuid.uuid4()), "role": "SUPER_ADMIN", "username": "root"})
    r = await aclient.patch(f"{API}/iam/users/{u.id}", json={"role": "EXECUTOR"}, headers=_bearer(root))
    assert r.status_code == 200, r.text
    assert (await aclient.get(f"{API}/iam/me/permissions", headers=_bearer(victim))).status_code == 401
    # Новый вход после смены роли работает (отзыв — «до момента», а не навсегда).
    assert (await _login(aclient)).status_code == 200
    assert len(await _events(db_session, "user.sessions_revoked")) == 1


async def test_password_reset_revokes_sessions(aclient, db_session):
    await ps.seed_rbac_defaults(db_session)
    u = await _user(db_session)
    victim = (await _login(aclient)).json()["access_token"]
    root = create_access_token({"sub": str(uuid.uuid4()), "role": "SUPER_ADMIN", "username": "root"})
    r = await aclient.post(f"{API}/iam/users/{u.id}/reset-password", json={"password": "Brand-New-Pass-7"}, headers=_bearer(root))
    assert r.status_code == 200
    assert (await aclient.get(f"{API}/iam/me/permissions", headers=_bearer(victim))).status_code == 401
    ev = await _events(db_session, "user.password_reset")
    assert len(ev) == 1 and ev[0].new_values is None


async def test_refresh_token_is_not_an_access_token(aclient, db_session):
    await ps.seed_rbac_defaults(db_session)
    refresh = create_refresh_token({"sub": str(uuid.uuid4()), "role": "QUALITY_MANAGER", "username": "x"})
    assert (await aclient.get(f"{API}/iam/me/permissions", headers=_bearer(refresh))).status_code == 401


def test_tokens_carry_revocation_claims():
    from app.modules.iam.security import decode_token
    p = decode_token(create_access_token({"sub": "u", "role": "ADMIN", "sid": "s1"}))
    assert p.jti and p.sid == "s1" and p.iat and p.type == "access"


# ═══════════════ ИБ-13: заголовки ═══════════════

async def test_security_headers_on_api_response(aclient):
    r = await aclient.get("/health")
    assert r.headers["X-Content-Type-Options"] == "nosniff"
    assert r.headers["X-Frame-Options"] == "DENY"
    assert "frame-ancestors 'none'" in r.headers["Content-Security-Policy"]
    assert "Strict-Transport-Security" not in r.headers    # HTTP — HSTS не выставляется
    assert r.headers.get("X-Request-ID")
    api = await aclient.get(f"{API}/auth/refresh")          # 405, но заголовки обязаны быть
    assert api.headers["Cache-Control"] == "no-store"


def test_hsts_only_for_https_and_docs_csp_allows_swagger():
    assert "Strict-Transport-Security" in headers_for("/api/v1/x", https=True)
    assert "Strict-Transport-Security" not in headers_for("/api/v1/x", https=False)
    assert "cdn.jsdelivr.net" in headers_for("/docs", https=False)["Content-Security-Policy"]
    assert "cdn.jsdelivr.net" not in headers_for("/api/v1/x", https=False)["Content-Security-Policy"]


def test_forwarded_for_trusted_only_from_proxy():
    assert resolve_client_ip("172.18.0.5", "203.0.113.7") == "203.0.113.7"     # прокси в docker-сети
    assert resolve_client_ip("198.51.100.9", "203.0.113.7") == "198.51.100.9"  # клиент подделывает заголовок


# ═══════════════ ИБ-09: маскирование ПДн и секретов ═══════════════

@pytest.mark.parametrize("raw, leaked", [
    ("пишите на ivanov@bank.ru", "ivanov@bank.ru"),
    ("тел. +7 (915) 123-45-67", "123-45-67"),
    ("Authorization: Bearer abcdefghijklmnop", "abcdefghijklmnop"),
    ("token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1In0.c2lnbmF0dXJlX19f", "eyJzdWIiOiJ1In0"),
    ("login password=Sup3rS3cret! ok", "Sup3rS3cret!"),
    ("DWH_URL задан (https://svc:p4ss@dwh.local/x)", "p4ss"),
    ("card 4276 3800 1234 5678", "4276 3800 1234 5678"),
    ("СНИЛС 112-233-445 95", "112-233-445 95"),
    ("ответственный Иванов Иван Петрович", "Иванов Иван Петрович"),
    ("ответственный Сидоров П.П.", "Сидоров П.П."),
])
def test_mask_sensitive(raw, leaked):
    assert leaked not in mask_sensitive(raw)


def test_mask_keeps_technical_identifiers():
    s = "мера 3f2b9c1e-8d4a-4c3b-9e2f-1a2b3c4d5e6f пересчитана, ALE 463500, характеристика Надёжность"
    assert mask_sensitive(s) == s


def test_filter_masks_formatted_message_and_args():
    rec = logging.LogRecord("x", logging.INFO, __file__, 1, "Уведомление %s → %r", ("Иванов И.И.", "a@b.ru"), None)
    PiiMaskingFilter().filter(rec)
    assert "Иванов" not in rec.getMessage() and "a@b.ru" not in rec.getMessage()


# ═══════════════ Пароль Redis ═══════════════

def test_production_refuses_redis_without_password():
    s = Settings(REDIS_URL="redis://redis:6379/0", DEMO_MODE=False)
    assert any("REDIS_URL без пароля" in i for i in s.security_issues())
    s = Settings(REDIS_URL="redis://:asok_redis_dev@redis:6379/0", DEMO_MODE=False)
    assert any("по умолчанию" in i and "REDIS" in i for i in s.security_issues())
    s = Settings(REDIS_URL="redis://:Xk2-long-random-secret@redis:6379/0", DEMO_MODE=False)
    assert not any("REDIS" in i for i in s.security_issues())
