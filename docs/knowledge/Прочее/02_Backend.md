---
tags:
  - бэк
---

---
tags: [асок-ис, backend, python, fastapi]
связи: [[00_Главный_Индекс]], [[01_Архитектура]], [[АСОК_ИС_DevOps]]
---

# ⚙️ АСОК ИС — Backend

## Структура файлов

```
backend/
├── app/
│   ├── main.py                    ← точка входа FastAPI
│   ├── init_db.py                 ← create_all (быстрый старт без alembic)
│   ├── api/
│   │   ├── deps.py                ← get_db(), get_current_user(), require_role()
│   │   └── v1/
│   │       ├── api.py             ← api_router (включает все эндпоинты)
│   │       ├── excel_upload.py    ← POST /excel/upload, GET /excel/tasks/{id}
│   │       ├── reports.py         ← GET /reports/{id}/xlsx|json|csv
│   │       └── endpoints/
│   │           ├── auth.py        ← POST /login  [исправлен v7: JSON]
│   │           ├── assessments.py ← GET /dashboard, GET/PUT /{id}/metrics [v7]
│   │           ├── metrics.py     ← GET /metrics (каталог)
│   │           └── systems.py     ← GET /systems [заглушка → нужен реальный]
│   ├── core/
│   │   ├── config.py              ← Settings(extra="ignore") [исправлен v6]
│   │   ├── database.py            ← async engine, get_db() [исправлен v6]
│   │   ├── security.py            ← bcrypt, JWT, decode_token() [исправлен v5]
│   │   └── rbac.py                ← require_roles(), require_any_authenticated [v5]
│   ├── db/
│   │   ├── base.py                ← Base(DeclarativeBase) + все модели [исправлен v6]
│   │   └── session.py             ← дубль database.py (можно удалить)
│   ├── models/
│   │   ├── base_mixin.py          ← TimestampMixin, SoftDeleteMixin
│   │   ├── user.py                ← User (5 ролей)
│   │   ├── system.py              ← System (ИС банка)
│   │   ├── metric_catalog.py      ← MetricCatalog (28 метрик МК_8.1)
│   │   ├── assessment.py          ← AssessmentPeriod, AssessmentValue
│   │   └── audit.py               ← ExpertJudgment (Append-Only)
│   ├── schemas/
│   │   ├── auth.py                ← LoginRequest, TokenResponse, TokenPayload [v5]
│   │   ├── assessment.py          ← EditableMetricOut/In, DashboardDataOut
│   │   ├── metric.py              ← MetricCatalogResponse
│   │   └── common.py              ← PaginatedResponse[T]
│   ├── services/
│   │   ├── calculation_engine.py  ← calculate_metric() — ГЛАВНЫЙ РАСЧЁТ
│   │   ├── calculator.py          ← дубль (синхронизировать)
│   │   ├── assessment.py          ← сервис периодов
│   │   ├── auth.py                ← ⚠️ содержит Pydantic схемы вместо логики
│   │   └── system.py              ← сервис ИС
│   ├── scripts/
│   │   ├── seed_metrics.py        ← 28 метрик → metric_catalog
│   │   ├── seed_demo.py           ← 5 ИС × 4 квартала × 28 метрик
│   │   └── init_db.py             ← дубль app/init_db.py
│   └── workers/
│       └── tasks.py               ← Celery: parse_excel, ai_summary, cache [исправлен v5]
├── alembic/
│   └── versions/
│       └── 001_initial_schema.py  ← создаёт все таблицы кроме users ⚠️
├── Dockerfile                     ← python:3.11-slim + pip install -e .
└── requirements.txt
```

---

## endpoints/auth.py
**Статус:** ✅ Исправлен в v7

```python
# Было (v6 и ранее) — СЛОМАНО:
@router.post("/login")
async def login(form_data: OAuth2PasswordRequestForm = Depends()):
    # ожидал Content-Type: application/x-www-form-urlencoded
    # фронт шлёт application/json → 422

# Стало (v7) — РАБОТАЕТ:
@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest):
    # LoginRequest — Pydantic модель, принимает JSON
    user = DEMO_USERS.get(body.username)
    if not user or body.password != user["password"]:
        raise HTTPException(401, "Неверные учётные данные")
    access_token = create_access_token({"sub": body.username, "role": user["role"]})
    return TokenResponse(access_token=access_token, ...)
```

Демо-пользователи (in-memory, БД не нужна):
| username | password | role |
|---|---|---|
| admin | Admin123! | ADMIN |
| analyst | Analyst123! | TEST_ANALYST |
| manager | Manager123! | QUALITY_MANAGER |
| demo | manager | QUALITY_MANAGER |
| cto | cto | CTO |

→ см. [[01_Архитектура#AUTH FLOW]]

---

## endpoints/assessments.py
**Статус:** ✅ Полностью переписан в v7

### GET /assessments/dashboard
Агрегирует данные всех систем для [[АСОК_ИС_Frontend#DashboardPage]]:
```python
{
  "globalHealthScore": 0.73,      # среднее X по всем метрикам
  "levelCounts": {                 # для Donut chart
    "Высокий уровень": 42,
    "Средний уровень": 31, ...
  },
  "heatmapData": [[0,1,4], ...],  # [xIdx, yIdx, level 0-5]
  "xAxisLabels": ["Функц. пригодность", ...],  # 9 характеристик
  "yAxisLabels": ["АБС", "ДБО", ...],           # названия ИС
  "problematicSystems": [...],     # топ-5 по числу низких метрик
  "totalMetrics": 140
}
```

### GET /assessments/{period_id}/metrics
Возвращает EditableMetricOut[] для [[АСОК_ИС_Frontend#MetricsInputPage]]

### PUT /assessments/{period_id}/metrics
Принимает EditableMetricIn[], вызывает [[#calculation_engine.py]], сохраняет в БД

---

## core/config.py
**Статус:** ✅ Исправлен в v6

```python
class Settings(BaseSettings):
    model_config = ConfigDict(
        extra="ignore",   # ← ключевое: игнорирует POSTGRES_PASSWORD из docker-compose
        env_file=".env",
    )
    JWT_SECRET_KEY: str = "dev_secret_key..."  # не JWT_SECRET !
    DATABASE_URL: str = "postgresql+asyncpg://..."
```

---

## calculation_engine.py
**Статус:** ✅ Ядро работает

```python
def calculate_metric(a, b, formula_type) → (float, str):
    if b == 0: return 0.0, "Невозможно измерить"
    X = a/b           # DIRECT
    X = 1 - a/b       # INVERSE
    X = clamp(X, 0, 1)
    # маппинг: 0.81→Высокий, 0.61→Выше среднего, 0.41→Средний, 0.21→Ниже среднего
```

→ см. [[01_Архитектура#CALCULATION ENGINE]]

---

## workers/tasks.py
**Статус:** ✅ Исправлен в v5 (был текст вместо кода)

- `parse_excel_task(file_path, period_id)` → openpyxl → BatchInsert
- `generate_ai_summary_task(period_id, system_name, period)` → Ollama
- `cache_invalidate_task(pattern)` → Redis keys delete

---

## Известные технические долги

| Проблема | Файл | Приоритет |
|---|---|---|
| Нет таблицы users в миграции 001 | alembic/versions/001 | 🔴 |
| services/auth.py содержит Pydantic схемы | services/auth.py | 🟡 |
| db/session.py — дубль database.py | db/session.py | 🔵 |
| calculator.py ≠ calculation_engine.py | services/ | 🔵 |
| systems.py — заглушка (return []) | endpoints/systems.py | 🟡 |

---

## 🔗 Связанные документы
- [[01_Архитектура]] — data flow и схема БД
- [[АСОК_ИС_Frontend]] — фронтенд компоненты
- [[АСОК_ИС_DevOps]] — docker, миграции
- [[АСОК_ИС_Статус_и_Бэклог]] — что сломано
