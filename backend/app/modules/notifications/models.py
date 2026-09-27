"""
Журнал отправок уведомлений (ТЗ v19 п.6, УК-15).

Критерий приёмки УК-15: «ни одно письмо не уходит без записи в журнале отправок». Поэтому
журнал ведёт не адаптер канала (он только доставляет), а модуль уведомлений: запись создаётся
на каждое событие — доставленное, упавшее при доставке или недоставляемое (у получателя нет
адреса). Недоставляемые не блокируют рассылку остальным и видны отдельным отчётом.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.infrastructure.database import Base

STATUS_SENT = "SENT"
STATUS_FAILED = "FAILED"                # канал ответил ошибкой — повтор по расписанию
STATUS_UNDELIVERABLE = "UNDELIVERABLE"  # адреса нет — повтор бессмыслен, нужен email
DELIVERY_STATUSES = (STATUS_SENT, STATUS_FAILED, STATUS_UNDELIVERABLE)

CHANNEL_EMAIL = "email"


class NotificationDelivery(Base):
    """Одна попытка оповестить одного адресата об одном событии (с её повторами)."""
    __tablename__ = "notification_deliveries"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    recipient: Mapped[str] = mapped_column(String(255), nullable=False)   # как эмитировано: ФИО/логин/роль
    address: Mapped[str | None] = mapped_column(String(1024), nullable=True)  # разрешённый email(ы)
    channel: Mapped[str] = mapped_column(String(32), nullable=False, default=CHANNEL_EMAIL)
    subject: Mapped[str] = mapped_column(String(512), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False, default="")
    entity_type: Mapped[str] = mapped_column(String(32), nullable=False)
    entity_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    # Вложения хранятся целиком: без них повтор отправил бы приглашение без календаря (УК-17).
    attachments: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Ключ дедупликации для событий по расписанию («срок через N дней» не шлётся каждую ночь).
    dedupe_key: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    is_retryable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
