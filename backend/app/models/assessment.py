```python
"""
ORM модели: AssessmentPeriod, AssessmentValue, ExpertJudgment.
ExpertJudgment — Append-Only история профессиональных суждений.
Соответствует ТЗ п.2: assessment_periods, assessment_values, expert_judgments.
"""
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
    assessment_values: Mapped[list["AssessmentValue"]] = relationship(
        "AssessmentValue", back_populates="period", lazy="select", cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("idx_periods_system_period", "system_id", "period", unique=True),
    )


class AssessmentValue(Base, TimestampMixin):
    __tablename__ = "assessment_values"

    QUALITY_LEVELS = (
        "Высокий уровень", "Уровень выше среднего", "Средний уровень",
        "Уровень ниже среднего", "Низкий уровень", "Невозможно измерить", "Н",
    )
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
    expert_judgments: Mapped[list["ExpertJudgment"]] = relationship(
        "ExpertJudgment", back_populates="assessment_value", lazy="select"
    )

    __table_args__ = (Index("idx_values_period", "period_id"),)


class ExpertJudgment(Base):
    """Append-Only: INSERT только. UPDATE/DELETE запрещены через RBAC."""
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
