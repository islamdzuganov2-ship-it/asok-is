---
tags:
  - бэк
---

# АСОК ИС — Backend Services, Schemas, API, Workers, Main
**Дата:** 2026-05-17 | **Итерация:** 1

## backend/app/services/calculator.py
```python
from dataclasses import dataclass

_QUALITY_THRESHOLDS: list[tuple[float, str]] = [
    (0.81, "Высокий уровень"),
    (0.61, "Уровень выше среднего"),
    (0.41, "Средний уровень"),
    (0.21, "Уровень ниже среднего"),
    (0.0,  "Низкий уровень"),
]

@dataclass(frozen=True)
class CalculationResult:
    x: float
    quality_level: str

def calculate_x(a: float | None, b: float | None, formula_type: str) -> CalculationResult:
    if formula_type not in ("DIRECT", "INVERSE"):
        raise ValueError(f"Неизвестный тип формулы: {formula_type!r}")
    if a is None or b is None or b == 0:
        return CalculationResult(x=0.0, quality_level="Невозможно измерить")
    raw = 1.0 - (float(a) / float(b)) if formula_type == "INVERSE" else float(a) / float(b)
    x = max(0.0, min(1.0, raw))
    return CalculationResult(x=round(x, 4), quality_level=_map_to_quality_level(x))

def _map_to_quality_level(x: float) -> str:
    if x == 0.0:
        return "Невозможно измерить"
    for threshold, level in _QUALITY_THRESHOLDS:
        if x >= threshold:
            return level
    return "Невозможно измерить"
```

## backend/app/schemas/auth.py
```python
from pydantic import BaseModel, Field

class LoginRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=100)
    password: str = Field(..., min_length=1, max_length=128)

class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    role: str

class RefreshRequest(BaseModel):
    refresh_token: str

class TokenPayload(BaseModel):
    sub: str
    role: str
    exp: int
```

## backend/app/schemas/system.py
```python
import uuid
from datetime import datetime
from typing import Literal
from pydantic import BaseModel, Field, ConfigDict

StatusLC = Literal["ОЭ", "ПЭ", "Создание и тестирование"]
CriticalityClass = Literal["MISSION CRITICAL", "BUSINESS CRITICAL", "BUSINESS OPERATIONAL"]

class SystemBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    code: str | None = Field(None, max_length=50)
    status_lc: StatusLC
    criticality_class: CriticalityClass
    owner: str | None = Field(None, max_length=255)
    is_active: bool = True

class SystemCreate(SystemBase):
    pass

class SystemUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=255)
    status_lc: StatusLC | None = None
    criticality_class: CriticalityClass | None = None
    owner: str | None = None
    is_active: bool | None = None

class SystemRead(SystemBase):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime

class SystemListResponse(BaseModel):
    items: list[SystemRead]
    total: int
    page: int
    page_size: int
```

## backend/app/schemas/assessment.py
```python
import uuid
from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict, field_validator

class AssessmentPeriodCreate(BaseModel):
    system_id: uuid.UUID
    period: str = Field(..., pattern=r"^Q[1-4]-\d{4}$")

class AssessmentPeriodRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    system_id: uuid.UUID
    period: str
    status: str
    created_by: uuid.UUID | None
    created_at: datetime

class MetricValueRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    metric_id: int
    val_a: float | None
    val_b: float | None
    calculated_x: float | None
    quality_level: str | None
    expert_comment: str | None
    artifact_links: list[str] | None
    data_source: str

class MetricValueUpdate(BaseModel):
    val_a: float | None = Field(None, ge=0)
    val_b: float | None = Field(None, ge=0)
    expert_comment: str | None = Field(None, max_length=2000)
    artifact_links: list[str] | None = Field(None, max_length=50)

    @field_validator("artifact_links")
    @classmethod
    def validate_artifact_links(cls, v):
        if v is None:
            return v
        for link in v:
            if not link.startswith(("http://", "https://")):
                raise ValueError(f"Некорректный URL: {link!r}")
        return v

class ExpertJudgmentCreate(BaseModel):
    assessment_value_id: uuid.UUID
    adjusted_level: str = Field(..., min_length=1, max_length=50)
    justification_text: str = Field(..., min_length=10, max_length=5000)
    linked_risk_task: str | None = Field(None, max_length=500)

class ExpertJudgmentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    assessment_value_id: uuid.UUID
    original_level: str | None
    adjusted_level: str
    justification_text: str
    linked_risk_task: str | None
    created_by: uuid.UUID | None
    created_at: datetime

class MetricsListResponse(BaseModel):
    period_id: uuid.UUID
    metrics: list[MetricValueRead]
```

## backend/app/api/v1/auth.py
(см. файл АСОК_ИС_01 — полный код auth router)

## backend/app/api/v1/assessments.py
(см. файл АСОК_ИС_01 — полный код assessments/metrics/expert-review routers)

## backend/app/workers/tasks.py
- `parse_excel_task` — валидация структуры xlsx, батчевая запись val_a/val_b, пересчёт X
- `generate_ai_summary_task` — сборка expert_comment → Ollama API → валидация длины >50 символов
- `cache_invalidate_task` — Redis keys pattern delete

## backend/app/main.py
- FastAPI app с CORS whitelist, Rate Limit 100/min (slowapi), Prometheus (prometheus-fastapi-instrumentator)
- /health (liveness), /ready (readiness: проверка PG + Redis)
- Lifespan: engine.dispose() при shutdown
