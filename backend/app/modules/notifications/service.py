"""
Модуль уведомлений (ТЗ v19 п.6, УК-15): журнал отправок, разрешение адреса, повторы.

Поток события: домен → `emit()`/`dispatch()` → адрес получателя (email пользователя или адреса
роли) → порт канала (`NotificationPort`, УК-16) с повторами → запись в журнале. Домены не знают
ни о канале, ни о журнале — только о каталоге событий (shared/notification_events.py).

Правила журнала:
  • запись есть у КАЖДОГО события, в том числе недоставляемого — «ни одно письмо не уходит без
    записи в журнале отправок»;
  • нет адреса → UNDELIVERABLE: порт всё равно получает событие (заглушка его логирует, боевой
    адаптер вернёт отказ), а получатель попадает в отчёт «недоставляемые» — рассылку остальным
    это не блокирует;
  • канал ответил ошибкой → до MAX_INLINE_ATTEMPTS повторов сразу, затем FAILED и повтор
    по расписанию (`retry_failed`) до MAX_TOTAL_ATTEMPTS.
"""
from __future__ import annotations

import logging
from dataclasses import replace
from datetime import datetime, timezone

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.integrations.notifications import get_notification_port
from app.modules.iam import User, get_role_permissions
from app.modules.notifications.models import (
    STATUS_FAILED,
    STATUS_SENT,
    STATUS_UNDELIVERABLE,
    NotificationDelivery,
)
from app.shared.notification_events import RECIPIENT_TOP_MANAGEMENT, render
from app.shared.ports import NotificationAttachment, NotificationEvent, NotificationPort

logger = logging.getLogger(__name__)

MAX_INLINE_ATTEMPTS = 3
MAX_TOTAL_ATTEMPTS = 6
TOP_MANAGEMENT_PERMISSION = "governance.decide"

REASON_NOT_FOUND = "получатель не найден среди пользователей системы"
REASON_NO_EMAIL = "у пользователя не заполнен email"
REASON_ROLE_EMPTY = "ни у одного пользователя с правом решения нет email"


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def resolve_address(db: AsyncSession, recipient: str) -> tuple[str | None, str | None]:
    """(адрес, причина недоставки). Получатель — логин или ФИО (так карточки хранят
    ответственных), либо роль «топ-менеджмент» — тогда адреса всех активных пользователей,
    чья роль имеет право решения по мерам."""
    if recipient == RECIPIENT_TOP_MANAGEMENT:
        users = list((await db.execute(select(User).where(User.is_active.is_(True)))).scalars().all())
        emails: list[str] = []
        for u in users:
            if u.email and TOP_MANAGEMENT_PERMISSION in await get_role_permissions(db, u.role):
                emails.append(u.email)
        return (", ".join(sorted(set(emails))), None) if emails else (None, REASON_ROLE_EMPTY)

    user = (await db.execute(
        select(User).where(
            User.is_active.is_(True),
            or_(User.username == recipient, User.full_name == recipient),
        ).limit(1)
    )).scalar_one_or_none()
    if user is None:
        return None, REASON_NOT_FOUND
    if not user.email:
        return None, REASON_NO_EMAIL
    return user.email, None


def _deliver(port: NotificationPort, event: NotificationEvent, attempts: int) -> tuple[bool, int, str | None]:
    """Доставка с повторами. Исключение адаптера — это отказ, а не падение домена: эмиттер
    не должен откатывать решение по мере из-за недоступного почтового сервера."""
    error: str | None = None
    for i in range(1, attempts + 1):
        try:
            if port.notify(event):
                return True, i, None
            error = "канал вернул отказ"
        except Exception as exc:  # noqa: BLE001 — любой сбой адаптера = неуспешная попытка
            error = f"{type(exc).__name__}: {exc}"
            logger.warning("Уведомление %s → %r: попытка %d не удалась: %s",
                           event.event_type, event.recipient, i, error)
    return False, attempts, error


def _attachments_json(atts: tuple[NotificationAttachment, ...]) -> list[dict] | None:
    return [{"filename": a.filename, "content_type": a.content_type, "content": a.content}
            for a in atts] or None


def _attachments_from(json_atts: list[dict] | None) -> tuple[NotificationAttachment, ...]:
    return tuple(NotificationAttachment(**a) for a in (json_atts or []))


async def dispatch(
    db: AsyncSession, event: NotificationEvent, *, port: NotificationPort | None = None,
    dedupe_key: str | None = None, commit: bool = True,
) -> NotificationDelivery | None:
    """Отправить событие и записать его в журнал. None — событие с этим ключом уже было."""
    if dedupe_key and (await db.execute(
        select(NotificationDelivery.id).where(NotificationDelivery.dedupe_key == dedupe_key).limit(1)
    )).first():
        return None

    address, reason = await resolve_address(db, event.recipient)
    event = replace(event, address=address)
    ok, attempts, error = _deliver(port or get_notification_port(), event, MAX_INLINE_ATTEMPTS)
    now = _now()
    if address is None:
        status = STATUS_UNDELIVERABLE
    else:
        status, reason = (STATUS_SENT, None) if ok else (STATUS_FAILED, error)

    row = NotificationDelivery(
        event_type=event.event_type, recipient=event.recipient, address=address,
        subject=event.subject[:512], body=event.body or "",
        entity_type=event.entity_type, entity_id=event.entity_id,
        attachments=_attachments_json(event.attachments),
        status=status, reason=reason, attempts=attempts, dedupe_key=dedupe_key,
        is_retryable=status == STATUS_FAILED,
        created_at=now, last_attempt_at=now, sent_at=now if status == STATUS_SENT else None,
    )
    db.add(row)
    if commit:
        await db.commit()
    return row


async def emit(
    db: AsyncSession, event_type: str, recipient: str | None, *, entity_type: str, entity_id: str,
    port: NotificationPort | None = None, dedupe_key: str | None = None,
    attachments: tuple[NotificationAttachment, ...] = (), commit: bool = True, **ctx,
) -> NotificationDelivery | None:
    """Событие по шаблону каталога (УК-15). Без получателя — ничего: уведомлять некого, а
    запись «в никуда» маскировала бы пробел в данных (тот же принцип, что у governance)."""
    if not recipient or not recipient.strip():
        return None
    subject, body = render(event_type, **ctx)
    return await dispatch(db, NotificationEvent(
        event_type=event_type, recipient=recipient.strip(), subject=subject, body=body,
        entity_type=entity_type, entity_id=entity_id, attachments=attachments,
    ), port=port, dedupe_key=dedupe_key, commit=commit)


async def retry_failed(db: AsyncSession, *, port: NotificationPort | None = None) -> int:
    """Повтор FAILED-записей (по расписанию). Недоставляемые не повторяются: без адреса повтор
    ничего не изменит — нужен email в карточке пользователя."""
    rows = list((await db.execute(
        select(NotificationDelivery).where(
            NotificationDelivery.status == STATUS_FAILED,
            NotificationDelivery.attempts < MAX_TOTAL_ATTEMPTS,
        )
    )).scalars().all())
    port = port or get_notification_port()
    delivered = 0
    for row in rows:
        event = NotificationEvent(
            event_type=row.event_type, recipient=row.recipient, subject=row.subject, body=row.body,
            entity_type=row.entity_type, entity_id=row.entity_id, address=row.address,
            attachments=_attachments_from(row.attachments),
        )
        ok, _, error = _deliver(port, event, 1)
        row.attempts += 1
        row.last_attempt_at = _now()
        if ok:
            row.status, row.reason, row.sent_at, row.is_retryable = STATUS_SENT, None, _now(), False
            delivered += 1
        else:
            row.reason = error
            row.is_retryable = row.attempts < MAX_TOTAL_ATTEMPTS
    if rows:
        await db.commit()
    return delivered


async def list_log(db: AsyncSession, *, status: str | None = None, entity_id: str | None = None,
                   limit: int = 200) -> list[NotificationDelivery]:
    stmt = select(NotificationDelivery).order_by(NotificationDelivery.created_at.desc()).limit(limit)
    if status:
        stmt = stmt.where(NotificationDelivery.status == status)
    if entity_id:
        stmt = stmt.where(NotificationDelivery.entity_id == entity_id)
    return list((await db.execute(stmt)).scalars().all())


async def undeliverable_report(db: AsyncSession) -> list[dict]:
    """Отчёт «недоставляемые» (УК-15): кому не дошло, почему и сколько раз."""
    rows = (await db.execute(
        select(
            NotificationDelivery.recipient, NotificationDelivery.reason,
            func.count(NotificationDelivery.id), func.max(NotificationDelivery.created_at),
        )
        .where(NotificationDelivery.status == STATUS_UNDELIVERABLE)
        .group_by(NotificationDelivery.recipient, NotificationDelivery.reason)
        .order_by(func.count(NotificationDelivery.id).desc())
    )).all()
    return [{"recipient": r, "reason": reason, "events": n, "last_at": last}
            for r, reason, n, last in rows]
