"""
REST API администрирования доступа (BL-008): управление пользователями и матрицей прав.

Монтируется под /iam. Доступ:
  · пользователи   — право admin.users.manage (по умолчанию только у SUPER_ADMIN);
  · матрица прав   — чтение view.admin.permissions, запись admin.permissions.manage;
  · /me/permissions — любому аутентифицированному (фронт берёт свой набор прав).
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.database import get_db
from app.modules.iam.deps import get_current_user, require_permission
from app.modules.iam.models import User
from app.modules.iam.permissions import PERMISSIONS, group_order
from app.modules.iam.permissions_service import (
    get_matrix,
    get_role_permissions,
    set_role_permissions,
)
from app.modules.iam.schemas import (
    MePermissionsOut,
    PasswordResetIn,
    PermissionCatalogOut,
    PermissionOut,
    RolePermsIn,
    UserAdminOut,
    UserCreateIn,
    UserUpdateIn,
)
from app.modules.iam.security import get_password_hash

router = APIRouter()


def _user_out(u: User) -> UserAdminOut:
    return UserAdminOut(
        id=str(u.id), username=u.username, email=u.email,
        full_name=u.full_name, role=u.role, is_active=u.is_active,
    )


def _validate_role(role: str) -> None:
    if role not in User.ALL_ROLES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Неизвестная роль: {role}",
        )


# ═══════════════════════ Свои права (для фронтового гейтинга) ═══════════════════════

@router.get("/me/permissions", response_model=MePermissionsOut)
async def my_permissions(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MePermissionsOut:
    roles = current_user.get("roles", [])
    role = roles[0] if roles else ""
    perms = await get_role_permissions(db, role)
    return MePermissionsOut(role=role, permissions=sorted(perms))


# ═══════════════════════ Каталог прав и матрица ═══════════════════════

@router.get("/permissions/catalog", response_model=PermissionCatalogOut)
async def permissions_catalog(
    _: dict = Depends(require_permission("view.admin.permissions")),
) -> PermissionCatalogOut:
    return PermissionCatalogOut(
        groups=group_order(),
        permissions=[PermissionOut(key=p.key, group=p.group, label=p.label, description=p.description)
                     for p in PERMISSIONS],
        roles=list(User.ALL_ROLES),
    )


@router.get("/permissions/matrix", response_model=dict[str, list[str]])
async def permissions_matrix(
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("view.admin.permissions")),
) -> dict[str, list[str]]:
    return await get_matrix(db)


@router.put("/permissions/matrix/{role}", response_model=dict[str, list[str]])
async def update_role_permissions(
    role: str,
    payload: RolePermsIn,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("admin.permissions.manage")),
) -> dict[str, list[str]]:
    _validate_role(role)
    saved = await set_role_permissions(db, role, payload.permissions)
    return {role: saved}


# ═══════════════════════ Пользователи ═══════════════════════

@router.get("/users", response_model=list[UserAdminOut])
async def list_users(
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("admin.users.manage")),
) -> list[UserAdminOut]:
    rows = (await db.execute(
        select(User).where(User.is_deleted.is_(False)).order_by(User.created_at)
    )).scalars().all()
    return [_user_out(u) for u in rows]


@router.post("/users", response_model=UserAdminOut, status_code=201)
async def create_user(
    payload: UserCreateIn,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("admin.users.manage")),
) -> UserAdminOut:
    _validate_role(payload.role)
    dup = (await db.execute(select(User).where(User.username == payload.username))).scalar_one_or_none()
    if dup is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Логин уже занят")
    user = User(
        username=payload.username,
        email=payload.email,
        full_name=payload.full_name or payload.username.title(),
        password_hash=get_password_hash(payload.password),
        role=payload.role,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return _user_out(user)


async def _get_user_or_404(db: AsyncSession, user_id: str) -> User:
    try:
        uid = uuid.UUID(user_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Пользователь не найден") from exc
    user = await db.get(User, uid)
    if user is None or user.is_deleted:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    return user


@router.patch("/users/{user_id}", response_model=UserAdminOut)
async def update_user(
    user_id: str,
    payload: UserUpdateIn,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_permission("admin.users.manage")),
) -> UserAdminOut:
    user = await _get_user_or_404(db, user_id)
    if payload.role is not None:
        _validate_role(payload.role)
        user.role = payload.role
    if payload.full_name is not None:
        user.full_name = payload.full_name
    if payload.is_active is not None:
        # Нельзя деактивировать собственную учётку (защита от самоблокировки).
        if not payload.is_active and str(user.id) == str(current_user.get("id")):
            raise HTTPException(status_code=400, detail="Нельзя деактивировать собственную учётную запись")
        user.is_active = payload.is_active
    await db.commit()
    await db.refresh(user)
    return _user_out(user)


@router.post("/users/{user_id}/reset-password", response_model=dict)
async def reset_password(
    user_id: str,
    payload: PasswordResetIn,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("admin.users.manage")),
) -> dict:
    user = await _get_user_or_404(db, user_id)
    user.password_hash = get_password_hash(payload.password)
    await db.commit()
    return {"ok": True}


@router.delete("/users/{user_id}", response_model=dict)
async def delete_user(
    user_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_permission("admin.users.manage")),
) -> dict:
    user = await _get_user_or_404(db, user_id)
    if str(user.id) == str(current_user.get("id")):
        raise HTTPException(status_code=400, detail="Нельзя удалить собственную учётную запись")
    user.is_active = False
    user.soft_delete()
    await db.commit()
    return {"ok": True}
