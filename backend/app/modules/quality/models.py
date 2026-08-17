"""
ORM-модели каталога метрик качества — домен quality (ТЗ v13).
"""
import enum
import uuid

from sqlalchemy import Boolean, Column, DateTime, Enum as SQLEnum, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.infrastructure.database import Base
from app.shared.db import TimestampMixin


class FormulaType(enum.Enum):
    DIRECT = "DIRECT"
    INVERSE = "INVERSE"


class MetricCatalog(Base):
    __tablename__ = "metric_catalog"

    id = Column(Integer, primary_key=True, index=True)
    characteristic = Column(String(255), nullable=False, index=True)
    subcharacteristic = Column(String(255), nullable=False)
    formula_type = Column(SQLEnum(FormulaType), nullable=False)
    description = Column(Text, nullable=True)
    data_source = Column(String(255), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)


class MetricCharacteristic(Base):
    __tablename__ = "metric_characteristics"
    id = Column(Integer, primary_key=True)
    name = Column(String)


class MetricAttribute(Base):
    __tablename__ = "metric_attributes"
    id = Column(Integer, primary_key=True)
    name = Column(String)


class WeightSetVersion(Base, TimestampMixin):
    """Версия весового вектора (ТЗ v19 УК-05, §6 ТЗ: «версия весов хранится вместе с оценкой»).

    Снимок САМОДОСТАТОЧЕН (полная копия весов в JSONB, не ссылка на app.modules.quality.weights) —
    так исторические баллы остаются воспроизводимыми, даже если код весов изменится или файл
    заказчика будет пересмотрен. РОВНО одна строка с is_active=True в любой момент времени —
    инвариант держит сервис (weight_versions.py), не БД-ограничение (упростить откат).
    """
    __tablename__ = "weight_set_versions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    label = Column(String(255), nullable=False)
    # ТЗ v19 УК-04/05 (редактор весов): w-уровень (подхарактеристика → характеристика), теперь
    # ПО ПРОФИЛЮ критичности — {"MISSION CRITICAL": [["характеристика","подхар.",вес_внутри_char], ...], ...},
    # вес нормирован НА 100 ВНУТРИ каждой характеристики (не на всю модель, как раньше) — см. char_weights.
    subchar_weights = Column(JSONB, nullable=False)
    # u-уровень (характеристика → интегральный Q), по профилю — {"MISSION CRITICAL": {"Надёжность": 20, ...}, ...},
    # Σ=100 по 8 характеристикам на каждый профиль. Итоговый вес подхарактеристики = u(char)×w(sub|char)/100.
    char_weights = Column(JSONB, nullable=True)
    criticality_weights = Column(JSONB, nullable=False)   # {"MISSION_CRITICAL": 3, ...} — ДРУГАЯ ось: вес класса ИС в портфеле, не путать с char_weights (вес характеристики внутри ИС)
    is_active = Column(Boolean, nullable=False, default=False)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    note = Column(Text, nullable=True)


class ScoreHistorySnapshot(Base):
    """Балл ИС за период, ЗАФИКСИРОВАННЫЙ под конкретной версией весов (УК-05/06).

    Дашборд считает баллы ЖИВЬЁМ под текущими активными весами (без изменений в перформансе
    относительно старого поведения) — эта таблица НЕ читается на каждый запрос дашборда, только
    при explicit «пересчитать историю» (см. weight_versions.recompute_and_snapshot) и при показе
    исторической динамики (пункт 1/15, задел под УК-01..03, УК-37). Обратимость: строки не
    перезаписываются, новый пересчёт добавляет новые строки под новой версией.
    """
    __tablename__ = "score_history_snapshots"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    weight_version_id = Column(UUID(as_uuid=True), ForeignKey("weight_set_versions.id"), nullable=False, index=True)
    period_id = Column(UUID(as_uuid=True), ForeignKey("assessment_periods.id"), nullable=False, index=True)
    system_id = Column(UUID(as_uuid=True), ForeignKey("systems.id"), nullable=False, index=True)
    system_name = Column(String(255), nullable=False)   # снимок имени — переименование ИС не рвёт историю
    score = Column(Numeric(6, 2), nullable=True)          # None — ни одной измеренной подхар. в периоде
    coverage = Column(Numeric(5, 4), nullable=False, default=0)
    breakdown = Column(JSONB, nullable=True)              # contributions из scoring.SystemScoreBreakdown
    computed_at = Column(DateTime(timezone=True), nullable=False)
