"""
REST API администрирования доступа (BL-008): управление пользователями и матрицей прав.

Монтируется под /iam. Доступ:
  · пользователи   — право admin.users.manage (по умолчанию только у SUPER_ADMIN);
  · матрица прав   — чтение view.admin.permissions, запись admin.permissions.manage;
  · /me/permissions — любому аутентифицированному (фронт берёт свой набор прав);
  · журнал ИБ      — чтение view.admin.audit (только SUPER_ADMIN, ИБ-08).

ИБ-08/ИБ-12: изменения пользователей и прав пишутся в журнал событий ИБ; смена роли,
блокировка, сброс пароля и удаление отзывают все сессии пользователя (токены, выданные
до изменения, перестают приниматься сразу, а не по истечении TTL).
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.database import get_db
from app.modules.iam import audit, sessions
from app.modules.iam.deps import get_current_user, require_permission
from app.modules.iam.models import User, UserPreference
from app.modules.iam.permissions import PERMISSIONS, group_order
from app.modules.iam.permissions_service import (
    BuiltinRoleError,
    get_mandatory_sections,
    get_matrix,
    get_role_permissions,
    set_mandatory_sections,
    set_role_permissions,
)
from app.modules.iam.schemas import (
    AuditEventOut,
    MandatorySectionsIn,
    MandatorySectionsOut,
    MePermissionsOut,
    PasswordResetIn,
    PermissionCatalogOut,
    PermissionOut,
    PreferencesIn,
    PreferencesOut,
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


def _current_uid(current_user: dict) -> uuid.UUID | None:
    try:
        return uuid.UUID(str(current_user.get("id")))
    except (ValueError, TypeError):
        return None


@router.get("/me/preferences", response_model=PreferencesOut)
async def get_my_preferences(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> PreferencesOut:
    uid = _current_uid(current_user)
    row = await db.get(UserPreference, uid) if uid else None
    return PreferencesOut(prefs=row.prefs if row else {})


@router.put("/me/preferences", response_model=PreferencesOut)
async def put_my_preferences(
    payload: PreferencesIn,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> PreferencesOut:
    uid = _current_uid(current_user)
    if uid is None:
        raise HTTPException(status_code=400, detail="Не удалось определить пользователя")
    row = await db.get(UserPreference, uid)
    if row is None:
        db.add(UserPreference(user_id=uid, prefs=payload.prefs))
    else:
        row.prefs = payload.prefs
    await db.commit()
    return PreferencesOut(prefs=payload.prefs)


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
    current_user: dict = Depends(require_permission("admin.permissions.manage")),
) -> dict[str, list[str]]:
    _validate_role(role)
    before = set(await get_role_permissions(db, role))
    try:
        saved = await set_role_permissions(db, role, payload.permissions)
    except BuiltinRoleError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await audit.record(db, audit.RBAC_MATRIX_CHANGE, user=current_user, entity_type="role", entity_key=role,
                       old={"removed": sorted(before - set(saved))}, new={"added": sorted(set(saved) - before)})
    await db.commit()
    return {role: saved}


# ═══════════════ Обязательные разделы (ТЗ v20 п.10) ═══════════════

@router.get("/mandatory-sections", response_model=MandatorySectionsOut)
async def list_mandatory_sections(
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(get_current_user),
) -> MandatorySectionsOut:
    """Открыт любому аутентифицированному: пользователь должен видеть, что именно закреплено
    администратором и почему тумблер в «Настройке» недоступен, а не гадать."""
    return MandatorySectionsOut(permissions=await get_mandatory_sections(db))


@router.put("/mandatory-sections", response_model=MandatorySectionsOut)
async def update_mandatory_sections(
    payload: MandatorySectionsIn,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_permission("admin.mandatory_sections.manage")),
) -> MandatorySectionsOut:
    before = set(await get_mandatory_sections(db))
    saved = await set_mandatory_sections(db, payload.permissions)
    await audit.record(db, audit.RBAC_MANDATORY_CHANGE, user=current_user, entity_type="mandatory_sections",
                       entity_key="*", old={"removed": sorted(before - set(saved))},
                       new={"added": sorted(set(saved) - before)})
    await db.commit()
    return MandatorySectionsOut(permissions=saved)


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
    current_user: dict = Depends(require_permission("admin.users.manage")),
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
    await db.flush()
    await audit.record(db, audit.USER_CREATE, user=current_user, entity_type="user", entity_id=user.id,
                       new={"username": user.username, "role": user.role, "email": user.email})
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
    before = {"role": user.role, "full_name": user.full_name, "is_active": user.is_active}
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
    after = {"role": user.role, "full_name": user.full_name, "is_active": user.is_active}
    changed = {k for k in after if after[k] != before[k]}
    if changed:
        await audit.record(db, audit.USER_UPDATE, user=current_user, entity_type="user", entity_id=user.id,
                           old={k: before[k] for k in changed}, new={k: after[k] for k in changed})
    # Смена роли или блокировка — принудительный разлогин (ИБ-12): права сессии выданы под
    # старую роль, заблокированный не должен дорабатывать остаток TTL токена.
    force_logout = "role" in changed or ("is_active" in changed and not user.is_active)
    if force_logout:
        await audit.record(db, audit.USER_SESSIONS_REVOKED, user=current_user, entity_type="user",
                           entity_id=user.id, new={"reason": "role_changed" if "role" in changed else "blocked"})
    await db.commit()
    if force_logout:
        await sessions.revoke_user(str(user.id))
    await db.refresh(user)
    return _user_out(user)


@router.post("/users/{user_id}/reset-password", response_model=dict)
async def reset_password(
    user_id: str,
    payload: PasswordResetIn,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_permission("admin.users.manage")),
) -> dict:
    user = await _get_user_or_404(db, user_id)
    user.password_hash = get_password_hash(payload.password)
    # Пароль в журнал не пишется — только факт сброса (audit._SECRET_FIELDS).
    await audit.record(db, audit.USER_PASSWORD_RESET, user=current_user, entity_type="user", entity_id=user.id)
    await db.commit()
    # Старые сессии держали доступ по старому паролю — после сброса они не должны жить.
    await sessions.revoke_user(str(user.id))
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
    await audit.record(db, audit.USER_DELETE, user=current_user, entity_type="user", entity_id=user.id,
                       old={"username": user.username, "role": user.role})
    await db.commit()
    await sessions.revoke_user(str(user.id))
    return {"ok": True}


# ═══════════════════════ Журнал событий ИБ (ИБ-08) ═══════════════════════

@router.get("/audit-log", response_model=list[AuditEventOut])
async def audit_log(
    action: str | None = None,
    username: str | None = None,
    limit: int = 200,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("view.admin.audit")),
) -> list[AuditEventOut]:
    """Последние события журнала ИБ (новые сверху). Только суперадминистратор."""
    rows = await audit.list_events(db, action=action, username=username, limit=max(1, min(limit, 1000)))
    return [AuditEventOut.model_validate(r, from_attributes=True) for r in rows]
