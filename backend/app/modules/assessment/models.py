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


class AiAssessmentValue(Base, TimestampMixin):
    """Значение метрики контура СИИ (ГОСТ Р 59898-2021, BL-001 E1).

    Отдельная таблица (не смешивается с ISO-контуром в дашбордах — требование ТЗ, часть G).
    Периоды переиспользуются (AssessmentPeriod). Строка = субхарактеристика модели 59898:
    ML-входы (inputs), baseline ± допуски (m_l, ε⁻, ε⁺), сырое значение, нормировка X∈[0,1]
    и вердикт соответствия (п. 7.1.3.3 / 7.2.2.3).
    """
    __tablename__ = "ai_assessment_values"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    period_id = Column(UUID(as_uuid=True), ForeignKey("assessment_periods.id"), nullable=False, index=True)
    group_name = Column(String(100), nullable=False)
    characteristic = Column(String(255), nullable=False)
    subcharacteristic = Column(String(255), nullable=False)

    metric_kind = Column(String(20), nullable=False)
    inputs = Column(JSONB, nullable=True)              # TP/TN/FP/FN, A/B, score…
    baseline = Column(Numeric(12, 4), nullable=True)   # базовое значение m_l
    tol_low = Column(Numeric(12, 4), nullable=True)    # допуск ε⁻
    tol_high = Column(Numeric(12, 4), nullable=True)   # допуск ε⁺

    raw_value = Column(Numeric(12, 4), nullable=True)    # значение метрики до нормировки (MSE/PSNR — вне [0,1])
    normalized_x = Column(Numeric(6, 4), nullable=True)  # X ∈ [0,1] к baseline
    conformant = Column(Boolean, nullable=True)          # в допуске / вне; NULL — эталон не задан

    unmeasurable = Column(Boolean, nullable=False, default=False, server_default="false")
    expert_comment = Column(Text, nullable=True)

    __table_args__ = (
        UniqueConstraint("period_id", "characteristic", "subcharacteristic", name="uq_ai_value_period_pair"),
    )


class AiWeight(Base, TimestampMixin):
    """Весовые коэффициенты свёртки контура СИИ (ГОСТ 59898, формулы 3–8; BL-001 E2).

    scope = 'CHARACTERISTIC'      → name = характеристика, weight = uₖ (вес в Q);
    scope = 'SUB:<характеристика>' → name = субхарактеристика, weight = wᵢ (вес в характеристике).
    Валидация Σ = 1 в пределах scope — на API (PUT /ai-assessments/{id}/weights).
    """
    __tablename__ = "ai_weights"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    period_id = Column(UUID(as_uuid=True), ForeignKey("assessment_periods.id"), nullable=False, index=True)
    scope = Column(String(280), nullable=False)
    name = Column(String(255), nullable=False)
    weight = Column(Numeric(6, 4), nullable=False)

    __table_args__ = (
        UniqueConstraint("period_id", "scope", "name", name="uq_ai_weight_scope_name"),
    )


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
