"""
Базовые доменные исключения (ТЗ v13). Не зависят от FastAPI/HTTP — на HTTP-коды
маппятся на уровне API (обработчиками исключений). Домены бросают эти типы вместо
прямого HTTPException, чтобы бизнес-логика не знала про транспорт.
"""
from __future__ import annotations


class DomainError(Exception):
    """Базовая ошибка бизнес-правила домена."""


class NotFoundError(DomainError):
    """Запрошенная сущность не найдена (→ HTTP 404)."""


class ConflictError(DomainError):
    """Конфликт состояния/уникальности (→ HTTP 409)."""


class ValidationError(DomainError):
    """Нарушение доменной валидации, не покрытой схемой (→ HTTP 422)."""


class PermissionDeniedError(DomainError):
    """Недостаточно прав/нарушение SoD (→ HTTP 403)."""


class IntegrationError(DomainError):
    """Сбой внешней интеграции (СУЗ/ТМС/ITSM/DWH) (→ HTTP 502/503)."""
