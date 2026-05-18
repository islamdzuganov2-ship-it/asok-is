```python
"""
ORM модель справочника ИС. Soft Delete через миксин.
Соответствует ТЗ п.2: таблица systems.
"""
import uuid
from sqlalchemy import String, Boolean, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base
from app.models.base_mixin import TimestampMixin, SoftDeleteMixin


class System(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "systems"

    STATUS_LC_VALUES = ("ОЭ", "ПЭ", "Создание и тестирование")
    CRITICALITY_VALUES = ("MISSION CRITICAL", "BUSINESS CRITICAL", "BUSINESS OPERATIONAL")

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    code: Mapped[str | None] = mapped_column(String(50), unique=True, nullable=True)
    status_lc: Mapped[str] = mapped_column(String(50), nullable=False)
    criticality_class: Mapped[str] = mapped_column(String(50), nullable=False)
    owner: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    assessment_periods: Mapped[list["AssessmentPeriod"]] = relationship(
        "AssessmentPeriod", back_populates="system", lazy="select"
    )

    __table_args__ = (
        Index("idx_systems_active", "is_active", "is_deleted"),
    )
```
