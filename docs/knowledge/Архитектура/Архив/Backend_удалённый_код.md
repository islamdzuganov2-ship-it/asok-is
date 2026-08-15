---
tags: [асок-ис, архив, backend, historical]
date: 2026-06-27
status: archived
---

# Архив: удалённый бэкенд-код

## `services/calculator.py` (дубль calculation_engine)
```python
from dataclasses import dataclass

_QUALITY_THRESHOLDS = [(0.81,"Высокий уровень"),(0.61,"Уровень выше среднего"),
    (0.41,"Средний уровень"),(0.21,"Уровень ниже среднего"),(0.0,"Низкий уровень")]

@dataclass(frozen=True)
class CalculationResult:
    x: float
    quality_level: str

def calculate_x(a, b, formula_type):
    if formula_type not in ("DIRECT","INVERSE"): raise ValueError(...)
    if a is None or b is None or b == 0:
        return CalculationResult(0.0, "Невозможно измерить")
    raw = 1.0-(a/b) if formula_type=="INVERSE" else a/b
    x = max(0.0, min(1.0, raw))
    return CalculationResult(round(x,4), map_to_quality_level(x))

def map_to_quality_level(x):
    if x == 0.0: return "Невозможно измерить"
    for t, level in _QUALITY_THRESHOLDS:
        if x >= t: return level
    return "Невозможно измерить"
```
> Живой аналог: `services/calculation_engine.py` (`calculate_metric`, `map_to_level`).

## `core/rbac.py` (параллельный RBAC, в роутерах не использовался)
```python
_bearer_scheme = HTTPBearer()
async def get_current_token(credentials = Depends(_bearer_scheme)) -> TokenPayload:
    try: return decode_token(credentials.credentials)
    except Exception: raise HTTPException(401, "Недействительный или истёкший токен.")

def require_roles(*allowed_roles):
    async def _check(token = Depends(get_current_token)):
        if token.role not in allowed_roles:
            raise HTTPException(403, f"Требуется: {', '.join(allowed_roles)}. Ваша роль: {token.role}.")
        return token
    return _check

require_admin             = require_roles("ADMIN")
require_manager_or_admin  = require_roles("QUALITY_MANAGER","ADMIN")
require_analyst_or_above  = require_roles("TEST_ANALYST","QUALITY_MANAGER","ADMIN")
require_any_authenticated = require_roles("TEST_ANALYST","QUALITY_MANAGER","CTO","CEO","ADMIN")
```
> Живой аналог: `api/deps.py::require_role`.

## `services/auth.py` (дубль схем — живые в `schemas/auth.py`)
```python
class LoginRequest(BaseModel): username: str; password: str
class TokenResponse(BaseModel): access_token; refresh_token; token_type="bearer"; role
class RefreshRequest(BaseModel): refresh_token: str
class TokenPayload(BaseModel): sub; role; exp
```

## `services/system.py` (дубль схем ИС)
```python
StatusLC = Literal["ОЭ","ПЭ","Создание и тестирование"]
CriticalityClass = Literal["MISSION CRITICAL","BUSINESS CRITICAL","BUSINESS OPERATIONAL"]
class SystemBase(BaseModel): name; code?; status_lc; criticality_class; owner?; is_active=True
class SystemCreate(SystemBase): ...
class SystemUpdate(BaseModel): ...
class SystemRead(SystemBase): id; created_at; updated_at
class SystemListResponse(BaseModel): items; total; page; page_size
```

## `services/assessment.py` (дубль схем + process_assessment_values)
```python
def process_assessment_values(metric_data, formula_type):
    x = calculate_metric(metric_data['val_a'], metric_data['val_b'], formula_type)
    return {"calculated_x": x, "quality_level": map_to_level(x)}

class AssessmentPeriodCreate(BaseModel): system_id; period (Q[1-4]-YYYY)
class AssessmentPeriodRead / MetricValueRead / MetricValueUpdate /
      ExpertJudgmentCreate / ExpertJudgmentRead / MetricsListResponse
# (валидация artifact_links: только http/https)
```

## `services/templates.py`
Пустой файл (0 строк).
