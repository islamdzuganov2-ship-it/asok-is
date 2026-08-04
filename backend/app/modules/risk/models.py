"""
ORM-модель сквозной (накопительной) базы рисков — домен risk (ТЗ v13).

В отличие от RiskMatrix (привязана к period_id, CASCADE — зеркало Excel за период),
RiskBase живёт независимо от периодов и служит источником знаний для LLM (grounding/RAG):
по просевшим характеристикам подбираются известные риски и типовые меры минимизации.
Пополняется вручную (UI), импортом из risk_matrices, из governance-мер, в перспективе — LLM.
Удаление заменено архивацией (статус) для воспроизводимости решений.
"""
import uuid

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Numeric, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.infrastructure.database import Base
from app.shared.db import TimestampMixin


class RiskBase(Base):
    __tablename__ = "risk_base"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code = Column(String, unique=True, nullable=False, index=True)   # R-TEST-001
    title = Column(String, nullable=False)
    category = Column(String, nullable=False, index=True)            # тестируемость, надёжность…
    characteristic = Column(String, nullable=True, index=True)       # ISO 25010 / МК_8.1
    subcharacteristic = Column(String, nullable=True)
    description = Column(Text, nullable=False)
    consequence = Column(Text, nullable=True)
    mitigation = Column(Text, nullable=True)
    severity = Column(String, nullable=False, default="medium")      # low/medium/high/critical
    likelihood = Column(String, nullable=False, default="medium")    # low/medium/high
    triggers = Column(Text, nullable=True)                           # признаки/пороги
    keywords = Column(Text, nullable=True)                           # для поиска LLM (через запятую)
    source = Column(String, nullable=False, default="manual")        # manual/excel/governance/llm
    system_id = Column(UUID(as_uuid=True), nullable=True)            # если риск специфичен для ИС
    status = Column(String, nullable=False, default="active", index=True)  # active/archived
    created_by = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


# ─────────────────────────────────────────────────────────────────────────────
# BL-007 (RE-08): рисковое событие с ЧИСЛОВЫМ ARO и графовыми связями.
#
# Решение заказчика: НЕ расширять risk_base (качественная база знаний для LLM-grounding),
# а завести отдельную числовую сущность risk_event со ссылкой на risk_base. Связи —
# многие-ко-многим: риск ↔ подхарактеристика, риск ↔ ТС (выборка реализаций), риск ↔ мера (§1.2).
# ─────────────────────────────────────────────────────────────────────────────

RISK_EVENT_ACTIVE = "active"
RISK_EVENT_ARCHIVED = "archived"


class RiskEvent(Base, TimestampMixin):
    """Рисковое событие (E4, числовой контур). ALE = ARO × SLE (§2.3)."""
    __tablename__ = "risk_events"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code = Column(String, unique=True, nullable=False, index=True)   # RE-2026-001
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    category = Column(String, nullable=True, index=True)
    # Владелец риска (RE-17): пока строка ФИО; при роли RISK_MANAGER — ссылка на пользователя.
    owner = Column(String, nullable=True)
    system_id = Column(UUID(as_uuid=True), nullable=True, index=True)   # если риск специфичен для ИС
    # Знаниевая карточка (мера минимизации/триггеры/ключевые слова для LLM) — необязательна.
    risk_base_id = Column(UUID(as_uuid=True), ForeignKey("risk_base.id"), nullable=True)

    # Частота реализаций в год. По фактике (число связанных ТС за окно) или экспертно (§2.3).
    aro = Column(Numeric(10, 4), nullable=True)
    aro_is_expert = Column(Boolean, nullable=False, default=False)     # ARO задан экспертно, не по ТС
    # SLE — средний C_ТС по реализациям (движок) или экспертная оценка при отсутствии реализаций.
    sle_expert = Column(Numeric(16, 2), nullable=True)
    # Кэш годовой стоимости (движок ALE, RE-09): средний / P90 «плохой год» / максимальный сценарий.
    ale_avg = Column(Numeric(16, 2), nullable=True)
    ale_p90 = Column(Numeric(16, 2), nullable=True)
    max_sle = Column(Numeric(16, 2), nullable=True)

    # Риск-аппетит по этому риску (переопределяет порог класса ИС, §3.2) и флаг регуляторного вето.
    risk_appetite = Column(Numeric(16, 2), nullable=True)
    regulatory = Column(Boolean, nullable=False, default=False)

    status = Column(String, nullable=False, default=RISK_EVENT_ACTIVE, index=True)
    created_by = Column(String, nullable=True)


class RiskEventSubchar(Base):
    """Связь риск ↔ подхарактеристика ГОСТ 25010 (одно несоответствие → много рисков и наоборот)."""
    __tablename__ = "risk_event_subchars"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    risk_event_id = Column(UUID(as_uuid=True), ForeignKey("risk_events.id", ondelete="CASCADE"),
                           nullable=False, index=True)
    characteristic = Column(String, nullable=False)
    subcharacteristic = Column(String, nullable=False)

    __table_args__ = (
        UniqueConstraint("risk_event_id", "characteristic", "subcharacteristic",
                         name="uq_risk_subchar"),
    )


class RiskEventIncident(Base):
    """Связь риск ↔ технический сбой: историческая статистика = выборка реализаций риска (§1.2)."""
    __tablename__ = "risk_event_incidents"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    risk_event_id = Column(UUID(as_uuid=True), ForeignKey("risk_events.id", ondelete="CASCADE"),
                           nullable=False, index=True)
    incident_id = Column(UUID(as_uuid=True), ForeignKey("tech_incidents.id", ondelete="CASCADE"),
                         nullable=False, index=True)

    __table_args__ = (
        UniqueConstraint("risk_event_id", "incident_id", name="uq_risk_incident"),
    )


class RiskEventMeasure(Base):
    """Связь риск ↔ мера. Одна мера → много рисков (эффект = Σ снятых ALE портфеля, §1.2)."""
    __tablename__ = "risk_event_measures"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    risk_event_id = Column(UUID(as_uuid=True), ForeignKey("risk_events.id", ondelete="CASCADE"),
                           nullable=False, index=True)
    proposal_id = Column(UUID(as_uuid=True), ForeignKey("proposals.id", ondelete="CASCADE"),
                         nullable=False, index=True)
    # Доля ALE риска, снимаемая этой мерой (для учёта перекрытия эффектов, §1.2 / RE-09).
    ale_reduction_share = Column(Numeric(5, 4), nullable=True)

    __table_args__ = (
        UniqueConstraint("risk_event_id", "proposal_id", name="uq_risk_measure"),
    )
