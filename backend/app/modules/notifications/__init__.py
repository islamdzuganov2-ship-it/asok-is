"""
Домен notifications — журнал отправок уведомлений и календарные приглашения (ТЗ v19 п.6,
УК-15/16/17). Канал доставки — порт `NotificationPort` (infrastructure/integrations/notifications),
каталог событий — shared/notification_events.py.
"""
from app.modules.notifications.ical import build_measure_event, measure_uid
from app.modules.notifications.models import (
    STATUS_FAILED,
    STATUS_SENT,
    STATUS_UNDELIVERABLE,
    NotificationDelivery,
)
from app.modules.notifications.service import dispatch, emit, retry_failed, undeliverable_report

__all__ = [
    "NotificationDelivery",
    "STATUS_SENT",
    "STATUS_FAILED",
    "STATUS_UNDELIVERABLE",
    "dispatch",
    "emit",
    "retry_failed",
    "undeliverable_report",
    "build_measure_event",
    "measure_uid",
]
