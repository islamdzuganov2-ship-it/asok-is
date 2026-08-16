"""
ORM-модель реестра ИС — домен systems (ТЗ v13).
"""
import enum
import uuid

from sqlalchemy import Boolean, Column, Enum as SQLEnum, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID

from app.infrastructure.database import Base
from app.shared.db import TimestampMixin


class LifecycleStatus(enum.Enum):
    OE = "ОЭ"
    PE = "ПЭ"
    DEV_TEST = "Создание и тестирование"


class CriticalityClass(enum.Enum):
    MISSION_CRITICAL = "MISSION CRITICAL"
    BUSINESS_CRITICAL = "BUSINESS CRITICAL"
    BUSINESS_OPERATIONAL = "BUSINESS OPERATIONAL"


class System(Base, TimestampMixin):
    __tablename__ = "systems"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    name = Column(String(255), nullable=False, index=True)
    code = Column(String(50), unique=True, index=True)
    status_lc = Column(SQLEnum(LifecycleStatus), nullable=False, default=LifecycleStatus.OE)
    criticality_class = Column(SQLEnum(CriticalityClass), nullable=False)
    # Тип системы: CLASSIC → контур ISO 25010; AI → контур ГОСТ Р 59898-2021 (BL-001).
    system_kind = Column(String(10), nullable=False, default="CLASSIC", server_default="CLASSIC")
    owner = Column(String(255), nullable=True)
    # ТЗ v19 УК-12/УК-14: FK на users.id — «связь с руководителем» на карточке ИС.
    # Строковый `owner` остаётся снимком имени, пока не сопоставлен (см. scripts/match_owners_to_users.py).
    owner_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True, index=True)
    # Вендор ИС (BL-007, RE-01) — для разреза дашборда стоимости и пересмотра контрактов (§2.4).
    vendor = Column(String(255), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    is_deleted = Column(Boolean, default=False, nullable=False)

    def __repr__(self):
        return f"<System(id={self.id}, name='{self.name}')>"
