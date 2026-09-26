"""
ORM-модели домена assessment (ТЗ v13): периоды оценки, значения метрик,
профессиональные суждения и история экспертных корректировок.
"""
import uuid

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
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
    # RE-19 (рычаг 2): глубина оценки по классу ИС — FULL (Mission) / PROFILE (Business) /
    # SCREENING (Support). Фиксируется при создании периода (quality.depth), finalize требует
    # только обязательный для глубины набор подхарактеристик. NULL — период до RE-19 → FULL.
    depth = Column(String(16), nullable=True)
    # RE-19 (норматив ч/ч): фактические часы аналитика на оценку — вводятся при завершении.
    analyst_hours = Column(Numeric(8, 2), nullable=True)
    # RE-19 (рычаг 4): период-источник дельта-переоценки (значения перенесены, пересчитаны
    # только изменённые подхарактеристики).
    carried_from_period_id = Column(UUID(as_uuid=True), nullable=True)

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
    # RE-19 (дельта-переоценка): значение перенесено из прошлого периода без изменений. Правка
    # значения снимает флаг — так видно, какие подхарактеристики реально переоценены.
    carried_over = Column(Boolean, nullable=False, default=False, server_default="false")

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


class AiTestDataset(Base, TimestampMixin):
    """Тестовый набор данных оценки СИИ (ГОСТ Р 59898-2021, разд. 9; BL-001 E3).

    Стандарт требует описать набор, на котором измерены метрики: объём, происхождение,
    репрезентативность и КРИТЕРИЙ ВЫБРОСОВ — без этого значения метрик невоспроизводимы.
    Результат проверки выбросов (метод, порог, число, доля) хранится рядом с набором.
    """
    __tablename__ = "ai_test_datasets"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    period_id = Column(UUID(as_uuid=True), ForeignKey("assessment_periods.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    purpose = Column(String(16), nullable=False, default="TEST")       # TEST | VALIDATION | STRESS
    records = Column(Integer, nullable=True)
    source = Column(Text, nullable=True)
    collected_from = Column(String(32), nullable=True)                 # период сбора, свободный текст «2026-Q2»
    representativeness = Column(Text, nullable=True)                   # чем набор репрезентативен для эксплуатации
    class_balance = Column(JSONB, nullable=True)                       # {класс: доля} для классификации
    outlier_method = Column(String(16), nullable=True)                 # IQR | ZSCORE
    outlier_k = Column(Numeric(6, 3), nullable=True)
    outlier_feature = Column(String(255), nullable=True)
    outliers_count = Column(Integer, nullable=True)
    outliers_share = Column(Numeric(6, 4), nullable=True)
    outlier_handling = Column(String(16), nullable=True)               # REMOVED | KEPT | WINSORIZED | FLAGGED
    notes = Column(Text, nullable=True)


class AiEnvParity(Base, TimestampMixin):
    """Паритет тестовой и эксплуатационной сред по фактору табл. 3 ГОСТ Р 59898-2021 (E3)."""
    __tablename__ = "ai_env_parity"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    period_id = Column(UUID(as_uuid=True), ForeignKey("assessment_periods.id", ondelete="CASCADE"), nullable=False, index=True)
    factor = Column(String(32), nullable=False)
    test_env = Column(Text, nullable=True)
    prod_env = Column(Text, nullable=True)
    status = Column(String(16), nullable=False)                        # MATCH | ACCEPTABLE | MISMATCH
    justification = Column(Text, nullable=True)

    __table_args__ = (UniqueConstraint("period_id", "factor", name="uq_ai_env_parity_factor"),)


class AiExpertScore(Base, TimestampMixin):
    """Оценка одного эксперта группы по субхарактеристике (ГОСТ Р 59898-2021, п. 7.2; E3).

    Группа экспертов оценивает субхарактеристики независимо; согласованность группы —
    коэффициент конкордации Кендалла (quality.ai_e3.kendall_w). Только при согласованной
    группе среднее переносится в значение метрики EXPERT_SCALE.
    """
    __tablename__ = "ai_expert_scores"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    period_id = Column(UUID(as_uuid=True), ForeignKey("assessment_periods.id", ondelete="CASCADE"), nullable=False, index=True)
    characteristic = Column(String(255), nullable=False)
    subcharacteristic = Column(String(255), nullable=False)
    expert = Column(String(100), nullable=False)                       # логин эксперта
    expert_name = Column(String(255), nullable=True)
    score = Column(Numeric(6, 2), nullable=False)                      # 0–100, та же шкала, что EXPERT_SCALE
    comment = Column(Text, nullable=True)

    __table_args__ = (
        UniqueConstraint("period_id", "characteristic", "subcharacteristic", "expert", name="uq_ai_expert_score"),
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


class OwnerChecklistItem(Base, TimestampMixin):
    """RE-19 (рычаг 3): self-service чек-лист владельца ИС.

    Владелец ИС сам собирает артефакты подтверждения по обязательным подхарактеристикам периода
    (ответ + ссылка на артефакт), аналитик верифицирует не всё, а СЛУЧАЙНУЮ выборку — это и
    снимает с аналитика сбор (перегруз объёмом §6.2), и сохраняет контроль достоверности.
    verification: PENDING (ждёт ответа) → SUBMITTED (владелец ответил) → VERIFIED/REJECTED
    (аналитик проверил выборку); NOT_SAMPLED — принято без проверки, в выборку не попало.
    """
    __tablename__ = "owner_checklist_items"
    __table_args__ = (UniqueConstraint("period_id", "characteristic", "subcharacteristic", name="uq_checklist_pair"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    period_id = Column(UUID(as_uuid=True), ForeignKey("assessment_periods.id", ondelete="CASCADE"), nullable=False, index=True)
    characteristic = Column(String(255), nullable=False)
    subcharacteristic = Column(String(255), nullable=False)
    question = Column(Text, nullable=False)
    answer = Column(Text, nullable=True)
    artifact_url = Column(String(1024), nullable=True)
    submitted_by = Column(String(255), nullable=True)
    submitted_at = Column(DateTime(timezone=True), nullable=True)
    sampled = Column(Boolean, nullable=False, default=False, server_default="false")
    verification = Column(String(16), nullable=False, default="PENDING", server_default="PENDING")
    verified_by = Column(String(255), nullable=True)
    verified_at = Column(DateTime(timezone=True), nullable=True)
    verifier_comment = Column(Text, nullable=True)
