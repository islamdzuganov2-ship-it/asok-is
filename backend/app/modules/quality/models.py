"""
ORM-модели каталога метрик качества — домен quality (ТЗ v13).
"""
import enum

from sqlalchemy import Boolean, Column, Enum as SQLEnum, Integer, String, Text

from app.infrastructure.database import Base


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
