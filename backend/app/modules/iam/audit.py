"""
Журнал событий ИБ (ИБ-08; SEC-03 в docs/SECURITY_AUDIT_RF_2026-09-08.md).

До ИБ-08 таблица `audit_log` существовала (миграция 013), но в неё не писалось ничего:
расследовать вход под чужой учёткой, смену прав или выгрузку отчёта было не по чему.

Как пользоваться:
    await audit.record(db, audit.AUTH_LOGIN, user=current_user, entity_type="user", ...)

`record` только добавляет строку в сессию — она фиксируется ВМЕСТЕ с бизнес-изменением
(одна транзакция: нет «решение принято, а записи нет» и наоборот). Для путей отказа, где
бизнес-изменения нет и дальше летит исключение (неудачный вход, блокировка), —
`record_now`: коммитит сразу, иначе откат сессии на исключении унёс бы и запись журнала.

Коды событий — константы ниже, не строки на месте (тот же приём, что у
shared/notification_events.py): опечатка становится ошибкой импорта.
Значения old/new проходят через маскирование — пароли и токены в журнал не попадают.
"""
from __future__ import annotations

import logging
import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.logging_config import mask_sensitive
from app.infrastructure.request_context import client_ip_var, request_id_var, user_agent_var
from app.modules.iam.models import AuditLog

logger = logging.getLogger(__name__)

# ── Коды событий ───────────────────────────────────────────────────────────────
AUTH_LOGIN = "auth.login"
AUTH_LOGIN_FAILED = "auth.login_failed"
AUTH_LOGIN_LOCKED = "auth.login_locked"
AUTH_LOGOUT = "auth.logout"
AUTH_REFRESH = "auth.refresh"
AUTH_REFRESH_DENIED = "auth.refresh_denied"
AUTH_REFRESH_REUSE = "auth.refresh_reuse"
USER_CREATE = "user.create"
USER_UPDATE = "user.update"
USER_DELETE = "user.delete"
USER_PASSWORD_RESET = "user.password_reset"
USER_PASSWORD_CHANGE = "user.password_change"   # ИБ-11: смена собственного пароля
USER_SESSIONS_REVOKED = "user.sessions_revoked"
RBAC_MATRIX_CHANGE = "rbac.matrix_change"
RBAC_MANDATORY_CHANGE = "rbac.mandatory_sections_change"
MEASURE_DECISION = "measure.decision"
MEASURE_ESCALATION_DECISION = "measure.escalation_decision"
REPORT_EXPORT = "report.export"
WEIGHTS_CHANGE = "quality.weights_change"

EVENTS: frozenset[str] = frozenset({
    AUTH_LOGIN, AUTH_LOGIN_FAILED, AUTH_LOGIN_LOCKED, AUTH_LOGOUT, AUTH_REFRESH, AUTH_REFRESH_DENIED,
    AUTH_REFRESH_REUSE, USER_CREATE, USER_UPDATE, USER_DELETE, USER_PASSWORD_RESET, USER_PASSWORD_CHANGE,
    USER_SESSIONS_REVOKED, RBAC_MATRIX_CHANGE, RBAC_MANDATORY_CHANGE, MEASURE_DECISION,
    MEASURE_ESCALATION_DECISION, REPORT_EXPORT, WEIGHTS_CHANGE,
})

OUTCOME_SUCCESS = "success"
OUTCOME_FAILURE = "failure"
OUTCOME_DENIED = "denied"

# Поля, значения которых не пишутся в журнал ни при каких условиях (только факт изменения).
_SECRET_FIELDS = {"password", "password_hash", "new_password", "token", "access_token", "refresh_token", "secret"}


def _as_uuid(value: Any) -> uuid.UUID | None:
    if value is None:
        return None
    if isinstance(value, uuid.UUID):
        return value
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError):
        return None


def _clean(values: dict | None) -> dict | None:
    if values is None:
        return None
    out: dict = {}
    for k, v in values.items():
        if k.lower() in _SECRET_FIELDS:
            out[k] = "[изменено]"
        elif isinstance(v, str):
            out[k] = mask_sensitive(v)
        elif isinstance(v, (int, float, bool)) or v is None:
            out[k] = v
        elif isinstance(v, (list, tuple, set)):
            out[k] = [mask_sensitive(x) if isinstance(x, str) else x for x in v]
        else:
            out[k] = mask_sensitive(str(v))
    return out


def build_entry(
    action: str,
    *,
    user: dict | None = None,
    username: str | None = None,
    outcome: str = OUTCOME_SUCCESS,
    entity_type: str | None = None,
    entity_id: Any = None,
    entity_key: str | None = None,
    old: dict | None = None,
    new: dict | None = None,
) -> AuditLog:
    if action not in EVENTS:
        raise ValueError(f"Неизвестный код события журнала ИБ: {action}")
    entity_uuid = _as_uuid(entity_id)
    return AuditLog(
        user_id=_as_uuid((user or {}).get("id")),
        username=(username or (user or {}).get("username") or None),
        action=action,
        outcome=outcome,
        entity_type=entity_type,
        entity_id=entity_uuid,
        # Не-UUID идентификатор (роль, право, вид выгрузки) — в entity_key, чтобы не терялся.
        entity_key=entity_key if entity_key is not None else (
            None if entity_uuid is not None or entity_id is None else str(entity_id)[:255]
        ),
        old_values=_clean(old),
        new_values=_clean(new),
        ip_address=client_ip_var.get(),
        user_agent=user_agent_var.get(),
        request_id=request_id_var.get(),
    )


async def record(db: AsyncSession, action: str, **kwargs: Any) -> AuditLog:
    """Добавить событие в текущую транзакцию (коммитит вызывающий вместе с бизнес-изменением)."""
    entry = build_entry(action, **kwargs)
    db.add(entry)
    logger.info("audit %s outcome=%s entity=%s/%s", action, entry.outcome, entry.entity_type,
                entry.entity_id or entry.entity_key)
    return entry


async def list_events(db: AsyncSession, *, action: str | None = None, username: str | None = None,
                      limit: int = 200) -> list[AuditLog]:
    q = select(AuditLog).order_by(AuditLog.created_at.desc()).limit(limit)
    if action:
        q = q.where(AuditLog.action == action)
    if username:
        q = q.where(AuditLog.username == username)
    return list((await db.execute(q)).scalars().all())


async def record_now(db: AsyncSession, action: str, **kwargs: Any) -> None:
    """Записать и сразу зафиксировать — для путей отказа, где дальше летит исключение.

    Ошибка записи журнала не должна превращать отказ во входе в 500: запись логируется,
    ответ пользователю остаётся прежним.
    """
    try:
        await record(db, action, **kwargs)
        await db.commit()
    except Exception:  # noqa: BLE001
        logger.exception("Не удалось записать событие журнала ИБ %s", action)
        await db.rollback()
