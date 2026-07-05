"""Pydantic-схемы контура оценки СИИ по ГОСТ Р 59898-2021 (BL-001 E1)."""
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field


class AiValueIn(BaseModel):
    """Ввод/обновление значения субхарактеристики СИИ (upsert по паре)."""
    characteristic: str = Field(..., min_length=1, max_length=255)
    subcharacteristic: str = Field(..., min_length=1, max_length=255)
    # По умолчанию берётся из каталога; можно переопределить (номенклатура настраиваемая, ТЗ ч.G).
    metric_kind: str | None = None
    inputs: dict[str, Any] | None = None      # TP/TN/FP/FN, A/B, score…
    baseline: float | None = Field(None, ge=0)
    tol_low: float | None = Field(None, ge=0)
    tol_high: float | None = Field(None, ge=0)
    expert_comment: str | None = Field(None, max_length=2000)
    unmeasurable: bool = False


class AiValueOut(BaseModel):
    id: str
    group_name: str
    characteristic: str
    subcharacteristic: str
    metric_kind: str
    inputs: dict[str, Any] | None = None
    baseline: float | None = None
    tol_low: float | None = None
    tol_high: float | None = None
    raw_value: float | None = None
    normalized_x: float | None = None
    conformant: bool | None = None
    unmeasurable: bool = False
    expert_comment: str | None = None
    is_ai_specific: bool = False


class AiPeriodCreate(BaseModel):
    system_id: UUID
    period: str = Field(..., min_length=1, max_length=20)


class AiCharacteristicScore(BaseModel):
    title: str
    score: float
    subs_measured: int


class AiCalculationOut(BaseModel):
    period_id: str
    q: float | None = None
    level: str
    characteristics: list[AiCharacteristicScore] = []
    values_total: int
    values_measured: int
    values_unmeasurable: int


class AiConformanceRow(BaseModel):
    characteristic: str
    subcharacteristic: str
    metric_kind: str
    raw_value: float | None = None
    baseline: float | None = None
    tol_low: float | None = None
    tol_high: float | None = None
    normalized_x: float | None = None
    verdict: str  # «В допуске» / «Вне допуска» / «Эталон не задан» / «Невозможно измерить»


class AiConformanceReport(BaseModel):
    period_id: str
    system_name: str
    period: str
    q: float | None = None
    level: str
    rows: list[AiConformanceRow]
    conformant_count: int
    nonconformant_count: int
    no_baseline_count: int
