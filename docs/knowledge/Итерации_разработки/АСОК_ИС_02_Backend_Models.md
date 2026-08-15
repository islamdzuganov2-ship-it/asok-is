---
tags:
  - бэк
---

# АСОК ИС — Backend Models
**Дата:** 2026-05-17 | **Итерация:** 1

## backend/app/models/base_mixin.py
```python
import uuid
from datetime import datetime, timezone
from sqlalchemy import Boolean, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column

class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

class SoftDeleteMixin:
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    def soft_delete(self) -> None:
        self.is_deleted = True
        self.deleted_at = datetime.now(timezone.utc)
```

## backend/app/models/system.py
```python
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
    assessment_periods: Mapped[list["AssessmentPeriod"]] = relationship("AssessmentPeriod", back_populates="system", lazy="select")

    __table_args__ = (Index("idx_systems_active", "is_active", "is_deleted"),)
```

## backend/app/models/metric_catalog.py
```python
from sqlalchemy import Integer, String, Text, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base

class MetricCatalog(Base):
    __tablename__ = "metric_catalog"
    FORMULA_DIRECT = "DIRECT"
    FORMULA_INVERSE = "INVERSE"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    characteristic: Mapped[str] = mapped_column(String(100), nullable=False)
    subcharacteristic: Mapped[str] = mapped_column(String(100), nullable=False)
    formula_type: Mapped[str] = mapped_column(String(20), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    data_source_hint: Mapped[str | None] = mapped_column(String(100), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    assessment_values: Mapped[list["AssessmentValue"]] = relationship("AssessmentValue", back_populates="metric", lazy="select")
```

## backend/app/models/assessment.py
```python
import uuid
from datetime import datetime
from sqlalchemy import String, Text, Numeric, DateTime, ForeignKey, Index, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base
from app.models.base_mixin import TimestampMixin

class AssessmentPeriod(Base, TimestampMixin):
    __tablename__ = "assessment_periods"
    STATUS_DRAFT = "DRAFT"
    STATUS_IN_PROGRESS = "IN_PROGRESS"
    STATUS_COMPLETED = "COMPLETED"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    system_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("systems.id"), nullable=False)
    period: Mapped[str] = mapped_column(String(20), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="DRAFT", nullable=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    system: Mapped["System"] = relationship("System", back_populates="assessment_periods")
    assessment_values: Mapped[list["AssessmentValue"]] = relationship("AssessmentValue", back_populates="period", lazy="select", cascade="all, delete-orphan")

    __table_args__ = (Index("idx_periods_system_period", "system_id", "period", unique=True),)

class AssessmentValue(Base, TimestampMixin):
    __tablename__ = "assessment_values"
    QUALITY_LEVELS = ("Высокий уровень", "Уровень выше среднего", "Средний уровень", "Уровень ниже среднего", "Низкий уровень", "Невозможно измерить", "Н")
    DATA_SOURCES = ("MANUAL", "EXCEL", "JIRA", "MONITORING")

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    period_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("assessment_periods.id"), nullable=False)
    metric_id: Mapped[int] = mapped_column(ForeignKey("metric_catalog.id"), nullable=False)
    val_a: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    val_b: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    calculated_x: Mapped[float | None] = mapped_column(Numeric(4, 2), nullable=True)
    quality_level: Mapped[str | None] = mapped_column(String(50), nullable=True)
    expert_comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    artifact_links: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    data_source: Mapped[str] = mapped_column(String(20), default="MANUAL", nullable=False)
    period: Mapped["AssessmentPeriod"] = relationship("AssessmentPeriod", back_populates="assessment_values")
    metric: Mapped["MetricCatalog"] = relationship("MetricCatalog", back_populates="assessment_values")
    expert_judgments: Mapped[list["ExpertJudgment"]] = relationship("ExpertJudgment", back_populates="assessment_value", lazy="select")

    __table_args__ = (Index("idx_values_period", "period_id"),)

class ExpertJudgment(Base):
    __tablename__ = "expert_judgments"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    assessment_value_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("assessment_values.id"), nullable=False)
    original_level: Mapped[str | None] = mapped_column(String(50), nullable=True)
    adjusted_level: Mapped[str] = mapped_column(String(50), nullable=False)
    justification_text: Mapped[str] = mapped_column(Text, nullable=False)
    linked_risk_task: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    assessment_value: Mapped["AssessmentValue"] = relationship("AssessmentValue", back_populates="expert_judgments")
```

## backend/app/models/user.py
```python
import uuid
from datetime import datetime
from sqlalchemy import String, Boolean, DateTime
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base
from app.models.base_mixin import TimestampMixin, SoftDeleteMixin

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
```

## backend/app/models/audit.py
```python
import uuid
from datetime import datetime
from sqlalchemy import String, DateTime
from sqlalchemy.dialects.postgresql import UUID, JSONB, INET
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base

class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    action: Mapped[str | None] = mapped_column(String(50), nullable=True)
    entity_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    entity_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    old_values: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    new_values: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    ip_address: Mapped[str | None] = mapped_column(INET, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default="now()", nullable=False)
```
