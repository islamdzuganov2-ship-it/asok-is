from sqlalchemy import Column, Integer, String, Text, Boolean, Enum as SQLEnum
from app.db.base import Base
import enum

class FormulaType(enum.Enum):
    DIRECT = "DIRECT"
    INVERSE = "INVERSE"

class MetricCatalog(Base):
    __tablename__ = "metric_catalog"
    id = Column(Integer, primary_key=True, index=True)
    characteristic = Column(String(255), nullable=False)
    subcharacteristic = Column(String(255), nullable=False)
    formula_type = Column(SQLEnum(FormulaType), nullable=False)
    description = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)