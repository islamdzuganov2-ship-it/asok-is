"""DTO журнала уведомлений (УК-15)."""
from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class _CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)


class NotificationDeliveryOut(_CamelModel):
    id: uuid.UUID
    event_type: str
    recipient: str
    address: str | None = None
    channel: str
    subject: str
    body: str
    entity_type: str
    entity_id: str
    has_attachments: bool = False
    status: str
    reason: str | None = None
    attempts: int
    created_at: datetime
    sent_at: datetime | None = None


class UndeliverableOut(_CamelModel):
    recipient: str
    reason: str | None = None
    events: int
    last_at: datetime | None = None


class RetryOut(_CamelModel):
    delivered: int
