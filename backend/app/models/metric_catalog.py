from sqlalchemy import Column, Integer, String, Boolean, Text, Enum as SQLEnum
import enum
from app.db.base import Base

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
