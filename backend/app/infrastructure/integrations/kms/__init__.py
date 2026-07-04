"""
Адаптер СУЗ (KMS) — реализация порта shared.ports.KnowledgeSource (ТЗ v13 §B5, фаза 4).

StubKnowledgeSource — безопасная заглушка: включается, пока KMS_API_URL не настроен.
Реальный адаптер (REST-клиент Confluence/собственной СУЗ) добавляется сюда же и выбирается
фабрикой get_knowledge_source() по конфигурации — домены изменений не требуют.
"""
from __future__ import annotations

import logging
from typing import Sequence

from app.infrastructure.config import settings
from app.shared.ports import KnowledgeArticle, KnowledgeSource

logger = logging.getLogger(__name__)


class StubKnowledgeSource:
    """Заглушка СУЗ: пустой поиск, публикация в лог. Держит контур рабочим без внешней системы."""

    def search(self, query: str, limit: int = 5) -> Sequence[KnowledgeArticle]:
        logger.debug("KMS stub search(%r, limit=%d) — интеграция не настроена (KMS_API_URL пуст)", query, limit)
        return []

    def publish(self, title: str, body: str, tags: Sequence[str] = ()) -> str:
        logger.info("KMS stub publish(%r) — интеграция не настроена, публикация пропущена", title)
        return "stub://not-published"


def get_knowledge_source() -> KnowledgeSource:
    """Фабрика адаптера СУЗ: пока URL не задан — заглушка."""
    # Реальный клиент появится здесь: if settings.KMS_API_URL: return HttpKnowledgeSource(...)
    if settings.KMS_API_URL:
        logger.warning("KMS_API_URL задан (%s), но HTTP-адаптер ещё не реализован — используется заглушка",
                       settings.KMS_API_URL)
    return StubKnowledgeSource()
