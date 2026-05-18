from sqlalchemy import Integer, String, Text, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base

class MetricCatalog(Base):
    __tablename__ = "metric_catalog"
    FORMULA_DIRECT = "DIRECT"
    FORMULA_INVERSE = "INVERSE"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    characteristic: Mapped[str] = mapped_column(String(100), nullable=False)
    subcharacteristic: Mapped[str] = mapped_column(String(100), nullable=False)
    formula_type: Mapped[str] = mapped_column(String(20), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    data_source_hint: Mapped[str | None] = mapped_column(String(100), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    assessment_values: Mapped[list["AssessmentValue"]] = relationship("AssessmentValue", back_populates="metric", lazy="select")