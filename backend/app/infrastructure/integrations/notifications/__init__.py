"""
Адаптер уведомлений — реализация порта shared.ports.NotificationPort (ТЗ v19 п.6, УК-06).

StubNotificationPort — безопасная заглушка: канал (SMTP/мессенджер) заказчиком НЕ выбран
(решение сессии, docs/ТЗ_19 §4 «В-...»). Событие пишется в лог, а не теряется молча — это
и есть спрос «строить порт и заглушку»: домены (governance и т.д.) уже эмитят реальные события
через NotificationPort, реальный канал подключается сюда же адаптером по конфигурации, когда
определится, — домены не меняются, как у kms/tms/itsm (тот же приём, см. соседние пакеты).
"""
from __future__ import annotations

import logging

from app.infrastructure.config import settings
from app.shared.ports import NotificationEvent, NotificationPort

logger = logging.getLogger(__name__)


class StubNotificationPort:
    """Заглушка доставки: событие уходит в лог, не во внешний канал. Контур остаётся рабочим
    и наблюдаемым (видно, что уведомление «должно было уйти») без настроенного SMTP."""

    def notify(self, event: NotificationEvent) -> bool:
        logger.info(
            "Уведомление (заглушка, канал не настроен): %s → %r | %s: %s (%s#%s)",
            event.event_type, event.recipient, event.subject, event.body,
            event.entity_type, event.entity_id,
        )
        return True


def get_notification_port() -> NotificationPort:
    """Фабрика адаптера уведомлений: пока канал не настроен — заглушка."""
    if settings.NOTIFICATION_SMTP_HOST:
        logger.warning(
            "NOTIFICATION_SMTP_HOST задан (%s), но SMTP-адаптер ещё не реализован — используется заглушка",
            settings.NOTIFICATION_SMTP_HOST,
        )
    return StubNotificationPort()
