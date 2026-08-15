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
    PROTECTED_SUPERADMIN_PERMISSIONS,
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
    """Заменить набор прав РЕДАКТИРУЕМОЙ роли (полная замена). Встроенные роли отклоняются.

    Права из PROTECTED_SUPERADMIN_PERMISSIONS отфильтровываются: они принадлежат исключительно
    суперадминистратору (управление доступом и самооценка LLM, ТЗ v18 п.10) и не должны
    выдаваться матрицей ни одной другой роли. Функция возвращает ФАКТИЧЕСКИ сохранённый набор,
    поэтому вызывающий UI видит результат фильтрации и может его отобразить.
    """
    if role in BUILTIN_ROLES:
        raise BuiltinRoleError(f"Роль {role} встроенная — права фиксированы")
    grantable = ALL_PERMISSION_KEYS - PROTECTED_SUPERADMIN_PERMISSIONS
    valid = {p for p in permissions if p in grantable}
    await db.execute(delete(RolePermission).where(RolePermission.role == role))
    for p in sorted(valid):
        db.add(RolePermission(role=role, permission=p))
    await db.commit()
    _invalidate()
    return sorted(valid)


async def seed_rbac_defaults(db: AsyncSession) -> int:
    """Идемпотентно: наполняет матрицу дефолтами и гарантирует пользователя superadmin.

    Два случая:
      · матрица пуста — первый запуск, пишутся все дефолты редактируемых ролей;
      · матрица наполнена — доводятся ТОЛЬКО права, которых нет ни у одной роли, то есть
        появившиеся в каталоге с новым релизом. Иначе новое право (например `systems.edit`,
        добавленное при закрытии ДЕФ-01) молча запрещало бы действие всем ролям, пока
        суперадмин не проставит галочку вручную. Уже встречавшиеся права не трогаются —
        там осознанное решение суперадмина.

    Возвращает число добавленных строк матрицы.
    """
    known = set((await db.execute(select(RolePermission.permission))).scalars().all())
    added = 0
    if not known:
        # Первый запуск: сеются только РЕДАКТИРУЕМЫЕ роли; ADMIN/SUPER_ADMIN — в коде.
        for role, perms in DEFAULT_ROLE_PERMISSIONS.items():
            for p in sorted(perms):
                db.add(RolePermission(role=role, permission=p))
                added += 1
    else:
        # Матрица уже наполнена. Досеиваем два случая:
        #
        #  1) НОВАЯ РОЛЬ — у роли нет ни одной строки. Значит, она появилась с релизом
        #     (например EXECUTOR, ДЕФ-10) и должна получить весь свой дефолтный набор.
        #     Без этого правила роль получала только те права, которых не было ни у кого
        #     другого: исполнителю досталось бы одно `view.my_tasks` вместо полного набора.
        #
        #  2) НОВОЕ ПРАВО — ключа нет НИ У ОДНОЙ роли, то есть он добавлен в каталог релизом
        #     (например `systems.edit`, ДЕФ-01). Иначе новое право молча запрещало бы
        #     действие всем редактируемым ролям до ручной правки матрицы.
        #
        # Права, уже встречавшиеся у существующей роли, не трогаем: там решение суперадмина.
        roles_with_rows = set(
            (await db.execute(select(RolePermission.role))).scalars().all()
        )
        for role, perms in DEFAULT_ROLE_PERMISSIONS.items():
            new_permissions = perms if role not in roles_with_rows else perms - known
            for p in sorted(new_permissions):
                db.add(RolePermission(role=role, permission=p))
                added += 1
    if added:
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
