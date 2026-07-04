"""
ORM-модель пользователя — домен iam (ТЗ v13). Роли и SoD — по ролевой модели v12.
"""
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.infrastructure.database import Base
from app.shared.db import SoftDeleteMixin, TimestampMixin


class User(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "users"
    ROLE_ANALYST = "TEST_ANALYST"
    ROLE_MANAGER = "QUALITY_MANAGER"
    ROLE_CTO = "CTO"
    ROLE_CEO = "CEO"
    ROLE_ADMIN = "ADMIN"
    ALL_ROLES = ("TEST_ANALYST", "QUALITY_MANAGER", "CTO", "CEO", "ADMIN")
    READONLY_ROLES = ("CTO", "CEO")

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    username: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    email: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    role: Mapped[str] = mapped_column(String(50), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    last_login: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
