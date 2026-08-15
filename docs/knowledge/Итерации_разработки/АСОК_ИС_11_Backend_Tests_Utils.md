---
tags:
  - бэк
---

# АСОК ИС — Backend Итерация 4: тесты, middleware, utils, AI router, миграция 002
**Дата:** 2026-05-17 | **Итерация:** 4 (финальная)

---

## backend/tests/conftest.py

Pytest фикстуры:
- `event_loop` (scope=session) — единый loop на всю сессию
- `setup_test_db` (autouse, session) — create_all перед, drop_all после
- `db_session` — AsyncSession с rollback после каждого теста (изоляция)
- `client` — httpx.AsyncClient с ASGITransport, переопределяет get_db
- `seed_metrics` — 5 тестовых MetricCatalog записей (id: 1,2,4,16,20)
- `analyst_user` → (User, access_token) для TEST_ANALYST
- `manager_user` → (User, access_token) для QUALITY_MANAGER
- `admin_user` → (User, access_token) для ADMIN

Тестовый движок: DATABASE_URL + "_test" суффикс (отдельная БД).

---

## backend/tests/test_auth.py

```
TestLogin:
  ✅ test_login_success — 200, access_token + refresh_token + role
  ✅ test_login_wrong_password — 401, единое сообщение (enumeration protection)
  ✅ test_login_nonexistent_user — 401
  ✅ test_login_inactive_user — 403
  ✅ test_login_soft_deleted_user — 401

TestRBAC:
  ✅ test_no_token_returns_401
  ✅ test_invalid_token_returns_401
  ✅ test_analyst_cannot_access_admin — 403 на POST /systems
  ✅ test_manager_can_create_expert_judgment — 201
```

---

## backend/tests/test_assessments.py

```
TestAssessmentPeriod:
  ✅ test_create_period_success — 201, status=DRAFT
  ✅ test_create_duplicate_period_returns_409 — 409 Conflict
  ✅ test_create_period_invalid_format — 422 (формат 2025-Q1 невалиден)
  ✅ test_get_metrics_returns_all_active — 5 метрик из seed

TestMetricUpdate:
  ✅ test_update_metric_recalculates_x — DIRECT: a=75, b=100 → X=0.75
  ✅ test_update_metric_direct_high_level — a=90 → Высокий уровень
  ✅ test_update_metric_inverse_formula — INVERSE: a=10 → X=0.9
  ✅ test_update_non_manual_source_blocked — EXCEL источник → 400
  ✅ test_update_metric_invalid_artifact_link — невалидный URL → 422
```

---

## backend/tests/test_systems.py

```
TestSystemsCRUD:
  ✅ test_list_systems_empty — 200, пустой список
  ✅ test_create_system_as_admin — 201, корректные данные
  ✅ test_create_duplicate_code_returns_409 — 409
  ✅ test_filter_by_criticality_class — только MISSION CRITICAL
  ✅ test_soft_delete_system — 204, is_deleted=True в БД, не в GET /systems
  ✅ test_patch_system — обновляет только переданные поля (exclude_unset)
```

---

## backend/tests/test_reports.py

```
TestReports:
  ✅ test_export_xlsx_returns_binary — spreadsheetml content-type, непустое тело
  ✅ test_export_json_structure — meta.period, meta.system.code, len(metrics)==5
  ✅ test_export_csv_has_bom — первые 3 байта \xef\xbb\xbf (UTF-8 BOM)
  ✅ test_export_nonexistent_period_404 — xlsx/json/csv все возвращают 404
```

---

## backend/app/api/v1/ai.py

POST /ai/summary:
- Feature Flag guard: FEATURE_AI_SUMMARY=false → 503 с пояснением
- Загружает period + system из БД
- generate_ai_summary_task.delay(period_id, system_name, period_label)
- Возвращает {task_id, status: PENDING, period_id, system_name}

GET /ai/summary/{task_id}:
- AsyncResult из Celery
- PENDING/STARTED → {status, summary: null}
- SUCCESS → {status: COMPLETED, summary: "...", reason}
- FAILURE → {status: FAILED, error: "..."}

---

## backend/app/core/middleware.py

TimingMiddleware:
- Добавляет X-Process-Time: {ms}ms к каждому ответу
- Используется для мониторинга latency (NFR: <200ms p95)

RequestIDMiddleware:
- Добавляет X-Request-ID: uuid4() к запросу и ответу
- Облегчает трассировку в логах и Prometheus

Подключение в main.py:
```python
app.add_middleware(TimingMiddleware)
app.add_middleware(RequestIDMiddleware)
```

---

## backend/app/utils/pagination.py

PaginationParams dataclass:
- page: int, page_size: int
- property offset: (page-1) * page_size

get_pagination() — FastAPI Dependency для Depends()

paginate_query(db, query, pagination) → (items, total):
- count через SELECT count() FROM subquery (один запрос)
- data с offset/limit

---

## backend/app/utils/cache.py

get_redis() — lazy singleton async Redis клиент

@cached(key_prefix, ttl_seconds) декоратор:
- Ключ: f"{prefix}:{hash(args+kwargs)}"
- Cache HIT → json.loads из Redis
- Cache MISS → вызов функции → setex в Redis
- Graceful degradation при Redis недоступен (логирует warning, отвечает напрямую)

invalidate_pattern(pattern) → int:
- Async инвалидация по паттерну (альтернатива Celery задаче для роутеров)

TTL по ТЗ:
- metric_catalog, systems: 86400 сек (24ч)
- assessment данные: 1800 сек (30м)

---

## backend/alembic/versions/002_seed_metric_catalog.py

Data migration: INSERT 28 метрик МК_8.1
- ON CONFLICT (id) DO NOTHING — идемпотентна
- Выполняется автоматически после 001 при alembic upgrade head
- downgrade: DELETE WHERE id BETWEEN 1 AND 28
- Исключает необходимость запуска seed_metrics.py вручную в prod

down_revision = "001_initial"
