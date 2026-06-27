"""
risk_base.py — сквозная (накопительная) база знаний о рисках качества ИС.

В отличие от RiskMatrix (привязана к period_id, CASCADE — зеркало Excel за период),
RiskBase живёт независимо от периодов и служит источником знаний для LLM
(grounding/RAG): по просевшим характеристикам подбираются известные риски и
типовые меры минимизации, чтобы рекомендации были обоснованы, а не выдуманы.

Пополняется: вручную (UI), импортом из risk_matrices, из governance-мер,
а в перспективе — самой LLM. Удаление заменено архивацией (статус) для
воспроизводимости решений.
"""
import uuid

from sqlalchemy import Column, DateTime, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.db.base import Base


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
