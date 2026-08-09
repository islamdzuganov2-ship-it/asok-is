"""
Резолвер прав (BL-008 RBAC): матрица role→permission из БД + кэш в процессе.

Кэш `{role: frozenset[perm]}` загружается лениво и сбрасывается при любой записи матрицы.
Кэш процессный: при нескольких воркерах uvicorn инвалидация не долетит до соседей — для
демо-стенда (один воркер) это допустимо; для прод-многопроцесса нужен внешний сигнал (Redis
pub/sub) — задел на будущее.

SUPER_ADMIN всегда получает ВЕСЬ каталог (мимо матрицы) — суперадмин не может себя заблокировать.
"""
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.iam.models import RolePermission, User
from app.modules.iam.permissions import (
    ADMIN_PERMISSIONS,
    ALL_PERMISSION_KEYS,
    BUILTIN_ROLES,
    DEFAULT_ROLE_PERMISSIONS,
)
from app.modules.iam.security import get_password_hash


class BuiltinRoleError(ValueError):
    """Попытка отредактировать права встроенной роли (ADMIN/SUPER_ADMIN)."""

# Логин/пароль первичного суперадмина (демо-учётка; в проде создаётся вручную/через IaC).
SUPERADMIN_USERNAME = "superadmin"
SUPERADMIN_PASSWORD = "Super123!"

_CACHE: dict[str, frozenset[str]] = {}
_CACHE_LOADED = False


def _invalidate() -> None:
    global _CACHE_LOADED
    _CACHE.clear()
    _CACHE_LOADED = False


def reset_cache() -> None:
    """Полный сброс кэша прав. Для тестов (изоляция) и ручной инвалидации."""
    _invalidate()


async def _ensure_loaded(db: AsyncSession) -> None:
    global _CACHE_LOADED
    if _CACHE_LOADED:
        return
    rows = (await db.execute(select(RolePermission))).scalars().all()
    matrix: dict[str, set[str]] = {}
    for r in rows:
        matrix.setdefault(r.role, set()).add(r.permission)
    # Собираем новый кэш локально, затем публикуем — чтобы гонка чтения не увидела полупустое.
    new_cache = {role: frozenset(perms) for role, perms in matrix.items()}
    _CACHE.clear()
    _CACHE.update(new_cache)
    _CACHE_LOADED = True


async def get_role_permissions(db: AsyncSession, role: str) -> frozenset[str]:
    """Полный набор прав роли. Встроенные роли — из кода (мимо матрицы)."""
    if role == User.ROLE_SUPER_ADMIN:
        return ALL_PERMISSION_KEYS
    if role == User.ROLE_ADMIN:
        return ADMIN_PERMISSIONS
    await _ensure_loaded(db)
    return _CACHE.get(role, frozenset())


async def get_matrix(db: AsyncSession) -> dict[str, list[str]]:
    """Текущая матрица для UI: {role: [perm, ...]} по всем ролям. Встроенные роли — из кода."""
    await _ensure_loaded(db)
    result: dict[str, list[str]] = {
        role: sorted(_CACHE.get(role, frozenset())) for role in User.ALL_ROLES
    }
    result[User.ROLE_ADMIN] = sorted(ADMIN_PERMISSIONS)
    result[User.ROLE_SUPER_ADMIN] = sorted(ALL_PERMISSION_KEYS)
    return result


async def set_role_permissions(db: AsyncSession, role: str, permissions: list[str]) -> list[str]:
    """Заменить набор прав РЕДАКТИРУЕМОЙ роли (полная замена). Встроенные роли отклоняются."""
    if role in BUILTIN_ROLES:
        raise BuiltinRoleError(f"Роль {role} встроенная — права фиксированы")
    valid = {p for p in permissions if p in ALL_PERMISSION_KEYS}
    await db.execute(delete(RolePermission).where(RolePermission.role == role))
    for p in sorted(valid):
        db.add(RolePermission(role=role, permission=p))
    await db.commit()
    _invalidate()
    return sorted(valid)


async def seed_rbac_defaults(db: AsyncSession) -> int:
    """Идемпотентно: если матрица пуста — пишет дефолты; всегда гарантирует пользователя superadmin.

    Возвращает число добавленных строк матрицы (0, если уже была наполнена).
    """
    already = (await db.execute(select(RolePermission.id).limit(1))).first()
    added = 0
    if already is None:
        # Сеются только РЕДАКТИРУЕМЫЕ роли; ADMIN/SUPER_ADMIN вычисляются в коде.
        for role, perms in DEFAULT_ROLE_PERMISSIONS.items():
            for p in sorted(perms):
                db.add(RolePermission(role=role, permission=p))
                added += 1
        await db.commit()
        _invalidate()

    su = (await db.execute(
        select(User).where(User.username == SUPERADMIN_USERNAME)
    )).scalar_one_or_none()
    if su is None:
        db.add(User(
            username=SUPERADMIN_USERNAME,
            email="superadmin@example.com",
            password_hash=get_password_hash(SUPERADMIN_PASSWORD),
            full_name="Супер-администратор",
            role=User.ROLE_SUPER_ADMIN,
        ))
        await db.commit()
    return added
