from sqlalchemy import Column, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.db.base import Base

class RiskMatrix(Base):
    """Модель для таблицы возможных рисков ИС."""
    __tablename__ = "risk_matrices"

    id = Column(Integer, primary_key=True, index=True)
    period_id = Column(UUID(as_uuid=True), ForeignKey("assessment_periods.id", ondelete="CASCADE"), nullable=False)
    
    characteristic = Column(String, nullable=False)
    subcharacteristic = Column(String, nullable=False)
    risk_description = Column(String, nullable=False)
    risk_consequence = Column(String, nullable=False)
    mitigation_measures = Column(String, nullable=False)

    period = relationship("AssessmentPeriod", backref="risks")

class DefectMatrix(Base):
    """Модель для перечня недостатков качества ИС."""
    __tablename__ = "defect_matrices"

    id = Column(Integer, primary_key=True, index=True)
    period_id = Column(UUID(as_uuid=True), ForeignKey("assessment_periods.id", ondelete="CASCADE"), nullable=False)
    
    characteristic = Column(String, nullable=False)
    digital_metric = Column(String, nullable=True)
    quality_metric_level = Column(String, nullable=True)
    defect_description = Column(String, nullable=False)

    period = relationship("AssessmentPeriod", backref="defects")

class QualityPlanMatrix(Base):
    """Модель для плана обеспечения качества ИС."""
    __tablename__ = "quality_plan_matrices"

    id = Column(Integer, primary_key=True, index=True)
    period_id = Column(UUID(as_uuid=True), ForeignKey("assessment_periods.id", ondelete="CASCADE"), nullable=False)
    
    characteristic = Column(String, nullable=False)
    subcharacteristic = Column(String, nullable=False)
    task_description = Column(String, nullable=False)
    internal_document = Column(String, nullable=True)
    assignee_fio = Column(String, nullable=True)
    assignee_role = Column(String, nullable=True)
    assignee_department = Column(String, nullable=True)
    deadline = Column(String, nullable=False)
    profile_executor = Column(String, nullable=True)
    tech_debt_link = Column(String, nullable=True)

    period = relationship("AssessmentPeriod", backref="quality_plans")
