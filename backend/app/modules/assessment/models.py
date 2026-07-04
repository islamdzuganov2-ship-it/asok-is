"""
ORM-модели домена assessment (ТЗ v13): периоды оценки, значения метрик,
профессиональные суждения и история экспертных корректировок.
"""
import uuid

from sqlalchemy import Boolean, Column, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship

from app.infrastructure.database import Base
from app.shared.db import TimestampMixin


class AssessmentPeriod(Base, TimestampMixin):
    __tablename__ = "assessment_periods"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    system_id = Column(UUID(as_uuid=True), ForeignKey("systems.id"), nullable=False, index=True)
    period = Column(String(20), nullable=False)
    status = Column(String(20), default="DRAFT")

    __table_args__ = (UniqueConstraint('system_id', 'period', name='uq_system_period'),)

    system = relationship("System", backref="periods")
    values = relationship("AssessmentValue", backref="period", cascade="all, delete-orphan")


class AssessmentValue(Base, TimestampMixin):
    __tablename__ = "assessment_values"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    period_id = Column(UUID(as_uuid=True), ForeignKey("assessment_periods.id"), nullable=False, index=True)
    metric_id = Column(Integer, ForeignKey("metric_catalog.id"), nullable=False, index=True)

    val_a = Column(Numeric(10, 2), nullable=True)
    val_b = Column(Numeric(10, 2), nullable=True)
    calculated_x = Column(Numeric(4, 2), nullable=True)
    quality_level = Column(String(50), nullable=True)

    # «Невозможно измерить»: нет возможности собрать данные. При True расчёт X не делается,
    # quality_level = «Невозможно измерить», а expert_comment ОБЯЗАТЕЛЕН (причина).
    unmeasurable = Column(Boolean, nullable=False, default=False, server_default="false")

    expert_comment = Column(Text, nullable=True)
    artifact_links = Column(JSONB, nullable=True)
    data_source = Column(String(20), default="MANUAL")

    metric = relationship("MetricCatalog", lazy="select")


class ProfessionalJudgment(Base, TimestampMixin):
    """Профессиональное суждение менеджера по качеству по подхарактеристике (НЕ мера).

    По одному на пару (характеристика, подхарактеристика) в периоде. Обязательно к заполнению
    (задача QM). На основе суждений LLM формирует заключение и маппит их на базу рисков.
    """
    __tablename__ = "professional_judgments"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    period_id = Column(UUID(as_uuid=True), ForeignKey("assessment_periods.id"), nullable=False, index=True)
    characteristic = Column(String(255), nullable=False)
    subcharacteristic = Column(String(255), nullable=False)
    judgment_text = Column(Text, nullable=False)
    author = Column(String(255), nullable=True)

    __table_args__ = (
        UniqueConstraint("period_id", "characteristic", "subcharacteristic", name="uq_judgment_period_pair"),
    )


class ExpertJudgmentHistory(Base, TimestampMixin):
    __tablename__ = "expert_judgment_history"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    assessment_value_id = Column(UUID(as_uuid=True), ForeignKey("assessment_values.id"), nullable=False, index=True)
    original_level = Column(String(50), nullable=True)
    adjusted_level = Column(String(50), nullable=True)
    justification_text = Column(Text, nullable=False)
    linked_risk_task = Column(String(500), nullable=True)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)

    assessment_value = relationship("AssessmentValue", backref="expert_judgments")
