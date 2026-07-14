"""
ORM-модель домена incidents (T-21, код-ревью 2026-07-06): технический сбой ИС (TechIncident).

Новое бизнес-направление — «аналитика технических сбоев»: отдельный анализатор надёжности как
дополнительный источник фактов для менеджера по качеству, топ-менеджмента (по флагу) и LLM.
Самостоятельный реестр — НЕ вмешивается в расчётный движок оценки качества (решение заказчика);
связь с ISO 25010 «Надёжность» — только на уровне аналитики и подсказок (маппинг в коде).

Классификация по первопричине (заказчик): привнесено релизом, инфраструктура, производительность,
сеть, электроснабжение. Набор расширяемый (строковые коды + валидация в схеме).
"""
import uuid
from datetime import datetime

from sqlalchemy import DateTime, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.infrastructure.database import Base
from app.shared.db import TimestampMixin

# Категории первопричины сбоя (расширяемый набор). Значения — стабильные коды для БД/фронта.
CATEGORY_RELEASE = "RELEASE"                # привнесено релизом (регрессия после развёртывания)
CATEGORY_INFRASTRUCTURE = "INFRASTRUCTURE"  # инфраструктура (серверы, СХД, ВМ, БД)
CATEGORY_PERFORMANCE = "PERFORMANCE"        # производительность (деградация, нехватка ресурсов)
CATEGORY_NETWORK = "NETWORK"                # сеть (связность, каналы, DNS, балансировка)
CATEGORY_POWER = "POWER"                    # электроснабжение (питание ЦОД, ИБП)
CATEGORY_OTHER = "OTHER"                    # пользовательская первопричина (текст — в category_custom, T-37)

CATEGORIES = (
    CATEGORY_RELEASE, CATEGORY_INFRASTRUCTURE, CATEGORY_PERFORMANCE,
    CATEGORY_NETWORK, CATEGORY_POWER, CATEGORY_OTHER,
)

# Маппинг первопричины сбоя → характеристика качества ISO 25010 (для риск-триггеров T-16):
# частые сбои категории проактивно «подсвечивают» риски по связанной характеристике.
CATEGORY_TO_CHARACTERISTIC: dict[str, str] = {
    CATEGORY_RELEASE: "Сопровождаемость",       # регрессии после релиза — тестируемость/сопровождаемость
    CATEGORY_INFRASTRUCTURE: "Надёжность",       # отказы инфраструктуры — зрелость/доступность
    CATEGORY_PERFORMANCE: "Производительность",   # деградация — время отклика/ресурсы/ёмкость
    CATEGORY_NETWORK: "Надёжность",              # сетевые сбои — доступность
    CATEGORY_POWER: "Надёжность",               # электроснабжение — отказоустойчивость
    CATEGORY_OTHER: "Надёжность",               # пользовательская — по умолчанию к надёжности
}

# Русские метки категорий (для сообщений backend, напр. пояснение риск-триггера).
CATEGORY_LABELS: dict[str, str] = {
    CATEGORY_RELEASE: "релиз",
    CATEGORY_INFRASTRUCTURE: "инфраструктура",
    CATEGORY_PERFORMANCE: "производительность",
    CATEGORY_NETWORK: "сеть",
    CATEGORY_POWER: "электроснабжение",
    CATEGORY_OTHER: "другое",
}

# Критичность сбоя — та же шкала, что у базы рисков (консистентность).
SEVERITIES = ("critical", "high", "medium", "low")

# Происхождение записи: ручной ввод (MVP), импорт, авто-приём из ITSM (задел, порт IncidentSource).
SOURCES = ("manual", "import", "itsm")


class TechIncident(Base, TimestampMixin):
    """Технический сбой ИС — запись реестра надёжности (домен incidents)."""
    __tablename__ = "tech_incidents"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    system_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    system_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)

    category: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    severity: Mapped[str] = mapped_column(String(16), nullable=False, default="medium")

    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    root_cause: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Ссылка на релиз/версию — для сбоев категории RELEASE (регрессия после развёртывания).
    release_ref: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # T-36: обязательные (для ручного ввода source=manual) поля разбора сбоя. Nullable в БД —
    # обязательность проверяет сервис (для manual), т.к. импорт/ITSM могут быть неполны.
    admission_cause: Mapped[str | None] = mapped_column(Text, nullable=True)          # причина допущения
    responsible_unit: Mapped[str | None] = mapped_column(String(255), nullable=True)  # виновное направление производства
    preventive_measures: Mapped[str | None] = mapped_column(Text, nullable=True)      # меры по неповторению
    # T-37: пользовательская первопричина, если category == OTHER.
    category_custom: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # T-42: связь с мерой по улучшению качества (governance Proposal). Свободная ссылка (без FK —
    # реестр мер может быть в отдельном хранилище/демо); опциональна (мера может появиться позже).
    linked_measure_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)

    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    # Пока NULL — сбой открыт (не восстановлен). Заполнено → закрыт, для расчёта MTTR.
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    source: Mapped[str] = mapped_column(String(16), nullable=False, default="manual")
    created_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
