"""Pydantic-схемы домена quality (каталог метрик), ТЗ v13."""
import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic.alias_generators import to_camel


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


# ── Веса подхарактеристик (ТЗ v19 УК-04..07) ──
class _CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)


class SubcharWeightOut(_CamelModel):
    characteristic: str
    subcharacteristic: str
    weight: float
    iso_key: str


class WeightsOut(_CamelModel):
    """Текущий применяемый весовой вектор — источник истины для расчёта Score (§1.0 ТЗ v19)."""
    active_version_id: uuid.UUID | None
    active_version_label: str | None
    total_weight: float
    subchar_weights: list[SubcharWeightOut]
    criticality_weights: dict[str, float]


# ── Редактор весов (ТЗ v19 УК-04/05/07) ──
class CharWeightRow(_CamelModel):
    characteristic: str
    weight: float  # u — вес характеристики в интегральном Q, Σ=100 по профилю


class SubcharWithinRow(_CamelModel):
    characteristic: str
    subcharacteristic: str
    weight: float  # w — вес подхарактеристики ВНУТРИ своей характеристики, Σ=100 на характеристику


class WeightEditorOut(_CamelModel):
    """Текущие u/w для правки — по выбранному профилю критичности (независимо от двух других)."""
    profile: str
    active_version_id: uuid.UUID
    active_version_label: str
    char_weights: list[CharWeightRow]
    subchar_within: list[SubcharWithinRow]


class WeightEditIn(_CamelModel):
    profile: str
    char_weights: list[CharWeightRow]
    subchar_within: list[SubcharWithinRow]
    note: str | None = None


class WeightEditErrorsOut(_CamelModel):
    """Отказ сохранения — список ошибок с указанием конкретной характеристики/строки, не
    общее «данные некорректны» (критерий приёмки п.2)."""
    errors: list[str]


class WeightVersionSummaryOut(_CamelModel):
    id: uuid.UUID
    label: str
    is_active: bool
    created_by: uuid.UUID | None
    created_at: datetime
    note: str | None
