"""Инвариант доступа: у каждого маршрута API есть гейт (ДЕФ-01).

Регресс, который этот тест закрывает: роутеры `systems` и `quality` были подключены
в `api/v1/api.py` вообще без зависимостей доступа. Анонимный `POST /api/v1/systems`
создавал запись в реестре ИС (проверено на живом стенде 2026-08-15, HTTP 201),
а `DELETE /api/v1/metrics/{id}` доходил до тела обработчика и удалил бы строку
каталога ISO 25010 — справочных данных, на которые опираются ВСЕ оценки, включая
закрытые периоды. Дефект не зависел от DEMO_MODE: это отсутствующая зависимость,
поэтому он сохранялся бы и в продуктиве.

Проверяем два уровня:
  1) каждый маршрут (кроме публичного белого списка) требует аутентификацию;
  2) каждый ИЗМЕНЯЮЩИЙ маршрут (POST/PUT/PATCH/DELETE) требует конкретное ПРАВО,
     а не просто «залогинен».
"""
from __future__ import annotations

from fastapi.routing import APIRoute

from app.main import app
from app.modules.iam.deps import get_current_user, get_current_user_changing_password

# Маршруты, которым аутентификация не нужна по определению.
PUBLIC_PATHS = {
    "/",
    "/health",
    "/openapi.json",
    "/docs",
    "/docs/oauth2-redirect",
    "/redoc",
    "/api/v1/auth/login",    # сам вход
    "/api/v1/auth/refresh",  # обмен refresh-токена
    # ИБ-11: формулировки требований к паролю — статичный текст без данных; нужен экрану смены
    # пароля и форме администратора.
    "/api/v1/auth/password-policy",
}

MUTATING_METHODS = {"POST", "PUT", "PATCH", "DELETE"}

# Изменяющие маршруты, которым отдельное право НЕ нужно: они пишут данные самого
# пользователя, а не общие. Гейта `get_current_user` достаточно — право здесь только
# мешало бы (персональные настройки должны быть у всех ролей).
SELF_SCOPED_WRITES = {
    "/api/v1/iam/me/preferences",
    # ИБ-12: серверный выход — отзывает ТОЛЬКО собственную сессию (sid текущего токена).
    "/api/v1/auth/logout",
    # ИБ-11: смена СОБСТВЕННОГО пароля (с проверкой текущего) — нужна каждой роли.
    "/api/v1/auth/change-password",
}

# Гейты аутентификации. `get_current_user_changing_password` — тот же 401 на отсутствующий или
# невалидный токен, но пропускает токен временного пароля (ИБ-11): им закрыты только смена
# пароля и выход, остальное через `get_current_user` отвечает 403 PASSWORD_CHANGE_REQUIRED.
AUTH_GATES = (get_current_user, get_current_user_changing_password)


def _dependency_calls(dependant) -> list:
    """Все вызываемые зависимости маршрута, включая вложенные."""
    found = []
    for sub in dependant.dependencies:
        if sub.call is not None:
            found.append(sub.call)
        found.extend(_dependency_calls(sub))
    return found


def _api_routes() -> list[APIRoute]:
    return [r for r in app.routes if isinstance(r, APIRoute) and r.path not in PUBLIC_PATHS]


def _has_auth(route: APIRoute) -> bool:
    return any(gate in _dependency_calls(route.dependant) for gate in AUTH_GATES)


def _has_permission_gate(route: APIRoute) -> bool:
    """`require_permission(...)` возвращает локальную функцию `checker`."""
    return any(
        getattr(call, "__qualname__", "").startswith(("require_permission.", "require_role."))
        for call in _dependency_calls(route.dependant)
    )


def test_every_route_requires_authentication():
    offenders = [
        f"{sorted(r.methods)} {r.path}"
        for r in _api_routes()
        if not _has_auth(r)
    ]
    assert not offenders, (
        "Маршруты без проверки аутентификации (доступны анонимно):\n  "
        + "\n  ".join(offenders)
    )


def test_every_mutating_route_requires_permission():
    offenders = [
        f"{sorted(r.methods & MUTATING_METHODS)} {r.path}"
        for r in _api_routes()
        if (r.methods & MUTATING_METHODS)
        and r.path not in SELF_SCOPED_WRITES
        and not _has_permission_gate(r)
    ]
    assert not offenders, (
        "Изменяющие маршруты без проверки ПРАВА (достаточно быть залогиненным):\n  "
        + "\n  ".join(offenders)
    )


def test_systems_and_quality_routers_are_gated():
    """Точечная проверка двух роутеров, где дефект был найден."""
    watched = {
        ("POST", "/api/v1/systems"),
        ("POST", "/api/v1/metrics/"),
        ("PUT", "/api/v1/metrics/{metric_id}"),
        ("DELETE", "/api/v1/metrics/{metric_id}"),
    }
    seen = set()
    for route in _api_routes():
        for method in route.methods:
            if (method, route.path) in watched:
                seen.add((method, route.path))
                assert _has_permission_gate(route), f"{method} {route.path} без проверки права"
    assert seen == watched, f"Не найдены маршруты: {sorted(watched - seen)}"


def test_temporary_password_gate_is_limited_to_change_and_logout():
    """ИБ-11: зависимость, пропускающая токен временного пароля, стоит только на смене пароля и
    выходе — иначе временный пароль открывал бы API в обход обязательной смены."""
    lenient = {
        r.path for r in _api_routes()
        if get_current_user_changing_password in _dependency_calls(r.dependant)
        and get_current_user not in _dependency_calls(r.dependant)
    }
    assert lenient == {"/api/v1/auth/logout", "/api/v1/auth/change-password"}, lenient
