"""Pydantic-схемы домена quality (каталог метрик), ТЗ v13."""
from pydantic import BaseModel, ConfigDict, Field, field_validator


class MetricBase(BaseModel):
    characteristic: str = Field(..., min_length=1, max_length=255)
    subcharacteristic: str = Field(..., min_length=1, max_length=255)
    formula_type: str = Field(..., pattern="^(DIRECT|INVERSE)$")
    description: str | None = None
    data_source: str | None = None
    is_active: bool = True

    @field_validator("formula_type", mode="before")
    @classmethod
    def normalize_formula_type(cls, value: object) -> str:
        if hasattr(value, "value"):
            return str(value.value)
        return str(value)


class MetricCreate(MetricBase):
    id: int | None = None


class MetricUpdate(BaseModel):
    characteristic: str | None = Field(None, min_length=1, max_length=255)
    subcharacteristic: str | None = Field(None, min_length=1, max_length=255)
    formula_type: str | None = Field(None, pattern="^(DIRECT|INVERSE)$")
    description: str | None = None
    data_source: str | None = None
    is_active: bool | None = None

    @field_validator("formula_type", mode="before")
    @classmethod
    def normalize_formula_type(cls, value: object) -> str | None:
        if value is None:
            return None
        if hasattr(value, "value"):
            return str(value.value)
        return str(value)


class MetricOut(MetricBase):
    model_config = ConfigDict(from_attributes=True)

    id: int


MetricCatalogResponse = MetricOut
