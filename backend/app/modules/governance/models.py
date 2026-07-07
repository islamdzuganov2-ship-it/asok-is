"""
ORM-модель домена governance (T-10, код-ревью 2026-07-06): мера качества (Proposal).

Переносит governance-петлю из фронтового слоя (Redux+localStorage `asok_governance_v2`) в БД —
чтобы меры/решения/эскалации/контроль исполнения СИНХРОНИЗИРОВАЛИСЬ между ролями и устройствами
(бизнес-требование заказчика). Поля зеркалят фронтовый интерфейс `Proposal` (governanceSlice.ts);
история правок хранится в JSONB (список записей аудита), как на фронте.

SoD (ролевая модель v12 §5.1) обеспечивается в роутере через require_role, инварианты статусов —
в сервисе: создаёт меру менеджер по качеству, решение принимает топ-менеджмент, контроль исполнения
и эскалацию ведёт менеджер по качеству, решение по эскалации — топ-менеджмент.
"""
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.infrastructure.database import Base
from app.shared.db import TimestampMixin

# Статусы меры (совпадают со строковыми литералами фронта — контракт не меняется).
STATUS_PENDING = "PENDING_APPROVAL"
STATUS_APPROVED = "APPROVED"
STATUS_REJECTED = "REJECTED"

EXECUTION_DONE = "DONE"
EXECUTION_NOT_DONE = "NOT_DONE"

ESCALATION_IGNORE = "IGNORE"
ESCALATION_REQUEST_MEASURES = "REQUEST_MEASURES"


class Proposal(Base, TimestampMixin):
    """Мера качества / профессиональное суждение менеджера по качеству (governance-петля)."""
    __tablename__ = "proposals"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # --- Источник постановки (профсуждение) ---
    system_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    system_name: Mapped[str] = mapped_column(String(255), nullable=False)
    characteristic: Mapped[str | None] = mapped_column(String(255), nullable=True)
    metric_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    calculated_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    calculated_level: Mapped[str | None] = mapped_column(String(64), nullable=True)
    adjusted_level: Mapped[str | None] = mapped_column(String(64), nullable=True)
    rationale: Mapped[str | None] = mapped_column(Text, nullable=True)
    expectation: Mapped[str | None] = mapped_column(Text, nullable=True)
    create_risk: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    risk_title: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # --- Ответственный / срок ---
    owner: Mapped[str | None] = mapped_column(String(255), nullable=True)
    owner_role: Mapped[str | None] = mapped_column(String(255), nullable=True)
    due_date: Mapped[str | None] = mapped_column(String(32), nullable=True)  # ISO-дата (как на фронте)

    # --- Решение топ-менеджмента (SoD) ---
    status: Mapped[str] = mapped_column(String(32), default=STATUS_PENDING, nullable=False, index=True)
    decided_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    decision_comment: Mapped[str | None] = mapped_column(Text, nullable=True)

    # --- Контроль исполнения (менеджер по качеству) ---
    execution: Mapped[str | None] = mapped_column(String(16), nullable=True)  # DONE/NOT_DONE
    execution_comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    executed_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    executed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # --- План задач / эскалация ---
    suz_link: Mapped[str | None] = mapped_column(String(512), nullable=True)
    top_comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    escalated: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    escalation_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    escalation_decision: Mapped[str | None] = mapped_column(String(32), nullable=True)
    escalation_decision_comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    escalation_decided_by: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # --- Аудит правок (список записей {at, by, field, from, to}) ---
    history: Mapped[list | None] = mapped_column(JSONB, nullable=True)

    # --- Демо-признак (в live-режиме демо-меры скрываются, как на фронте) ---
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    created_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
