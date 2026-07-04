"""
ORM-модель реестра ИС — домен systems (ТЗ v13).
"""
import enum
import uuid

from sqlalchemy import Boolean, Column, Enum as SQLEnum, String
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
    owner = Column(String(255), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    is_deleted = Column(Boolean, default=False, nullable=False)

    def __repr__(self):
        return f"<System(id={self.id}, name='{self.name}')>"
