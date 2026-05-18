# backend/app/models/assessment.py — ИСПРАВЛЕННЫЙ ФАЙЛ
from sqlalchemy import Column, Integer, String, Numeric, ForeignKey, Text, UniqueConstraint, Enum as SQLEnum
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
import uuid
import enum
from app.db.base import Base, TimestampMixin

class AssessmentPeriod(Base, TimestampMixin):
    __tablename__ = "assessment_periods"  # ✅ ДВА подчеркивания
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    system_id = Column(UUID(as_uuid=True), ForeignKey("systems.id"), nullable=False, index=True)
    period = Column(String(20), nullable=False)
    status = Column(String(20), default="DRAFT")
    
    __table_args__ = (UniqueConstraint('system_id', 'period', name='uq_system_period'),)
    
    system = relationship("System", backref="periods")
    values = relationship("AssessmentValue", backref="period", cascade="all, delete-orphan")


class AssessmentValue(Base, TimestampMixin):
    __tablename__ = "assessment_values"  # ✅ ДВА подчеркивания
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    period_id = Column(UUID(as_uuid=True), ForeignKey("assessment_periods.id"), nullable=False, index=True)
    metric_id = Column(Integer, ForeignKey("metric_catalog.id"), nullable=False, index=True)
    
    val_a = Column(Numeric(10, 2), nullable=True)
    val_b = Column(Numeric(10, 2), nullable=True)
    calculated_x = Column(Numeric(4, 2), nullable=True)
    quality_level = Column(String(50), nullable=True)
    
    expert_comment = Column(Text, nullable=True)
    artifact_links = Column(JSONB, nullable=True)
    data_source = Column(String(20), default="MANUAL")
    
    metric = relationship("MetricCatalog", lazy="select")


class ExpertJudgmentHistory(Base, TimestampMixin):
    __tablename__ = "expert_judgment_history"  # ✅ ДВА подчеркивания
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    assessment_value_id = Column(UUID(as_uuid=True), ForeignKey("assessment_values.id"), nullable=False, index=True)
    original_level = Column(String(50), nullable=True)
    adjusted_level = Column(String(50), nullable=True)
    justification_text = Column(Text, nullable=False)
    linked_risk_task = Column(String(500), nullable=True)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    
    assessment_value = relationship("AssessmentValue", backref="expert_judgments")