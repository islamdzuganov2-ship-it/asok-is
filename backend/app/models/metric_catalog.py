# backend/app/models/metric_catalog.py — СОЗДАТЬ, если отсутствует
from sqlalchemy import Column, Integer, String, Boolean, Text, Enum as SQLEnum
import enum
from app.core.database import Base
from app.models.base_mixin import TimestampMixin
class FormulaType(enum.Enum):
    DIRECT = "DIRECT"
    INVERSE = "INVERSE"

class MetricCatalog(Base):
    __tablename__ = "metric_catalog"  # ✅ ДВА подчеркивания
    
    id = Column(Integer, primary_key=True, index=True)
    characteristic = Column(String(255), nullable=False, index=True)
    subcharacteristic = Column(String(255), nullable=False)
    formula_type = Column(SQLEnum(FormulaType), nullable=False)
    description = Column(Text, nullable=True)
    data_source = Column(String(255), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)