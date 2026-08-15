---
tags: [асок-ис, архитектура, backend]
date: 2026-06-27
status: baseline
---

# Backend (FastAPI)

Корень: `backend/app/`. Точка входа: `app/main.py` (FastAPI, CORS, security-проверка конфигурации
на старте, сидинг в DEMO).

## 1. Структура каталогов
```
backend/app/
├── main.py                 # инициализация FastAPI, CORS, startup-проверки
├── api/
│   ├── deps.py             # ★ get_db, get_current_user, require_role (актуальный RBAC)
│   └── v1/
│       ├── api.py          # сборка api_router (подключение всех роутеров)
│       ├── excel_upload.py # загрузка/импорт Excel, проверка сигнатуры, авторизация
│       ├── reports.py      # дашборд, матрицы, llm-status; вызов LLM
│       ├── risk_base.py    # CRUD базы рисков + /search (grounding LLM)
│       └── endpoints/
│           ├── auth.py     # /login, /refresh (DEMO_USERS только в DEMO_MODE)
│           ├── assessments.py
│           ├── metrics.py
│           └── systems.py
├── core/
│   ├── config.py           # Settings (.env); LLM_*, security_issues()
│   ├── database.py         # async engine, AsyncSessionLocal, get_db
│   ├── security.py         # ★ bcrypt, JWT (create/decode, проверка типа)
│   └── rbac.py             # require_roles (ПАРАЛЛЕЛЬНЫЙ механизм — см. legacy)
├── db/
│   ├── base.py             # Base + регистрация всех моделей для Alembic/create_all
│   └── session.py
├── models/                 # SQLAlchemy ORM (см. §3)
├── schemas/                # Pydantic (auth, assessment, metric, risk_base, common)
├── services/               # бизнес-логика (см. §4)
├── workers/tasks.py        # Celery: parse_excel_task, generate_ai_summary_task
├── scripts/                # сидинг (seed_metrics, seed_risk_base, seed_demo, …)
└── alembic/versions/       # 001_initial, 002_excel_matrices, 003_risk_base
```

## 2. Эндпоинты (`/api/v1`, сборка в `api/v1/api.py`)
| Префикс | Файл | Ключевые маршруты | Доступ |
|---------|------|-------------------|--------|
| `/auth` | endpoints/auth.py | POST /login, /refresh | публично |
| `/systems` | endpoints/systems.py | CRUD ИС | авторизация |
| `/assessments` | endpoints/assessments.py | период, /{id}/metrics, /dashboard | авторизация |
| `/metrics` | endpoints/metrics.py | каталог метрик | авторизация |
| `/reports` | reports.py | /executive-dashboard, /…/matrices, /llm-status | авторизация |
| `/excel` | excel_upload.py | /upload, /import-assessment, /import-workbook, /seed-project-files | require_role |
| `/risks` | risk_base.py | "", /search, POST, PATCH /{id}, /{id}/archive, /import/{period} | read: auth; write: QM/ADMIN |

## 3. Модели данных (`models/`)
| Файл | Таблица | Назначение | Связи |
|------|---------|-----------|-------|
| user.py | users | пользователи, роли | — |
| system.py | systems | ИС | 1—n periods |
| metric_catalog.py | metric_catalog | каталог метрик (DIRECT/INVERSE) | — |
| assessment.py | assessment_periods, assessment_values, expert_judgment_history | период оценки + значения val_a/val_b/X | period→system, value→metric/period |
| matrices.py | risk_matrices, defect_matrices, quality_plan_matrices | зеркало Excel **по периоду** (CASCADE) | →period |
| risk_base.py | risk_base | сквозная база рисков (grounding LLM) | system_id (опц.) |
| audit.py | audit | журнал событий (модель есть, запись — в бэклоге S10) | — |
| base_mixin.py | — | общие поля (timestamps/мягкое удаление) | mixin |

Регистрация моделей — `db/base.py` (важно для `create_all`/Alembic autogenerate).

## 4. Сервисы (`services/`)
| Файл | Роль | Статус |
|------|------|--------|
| calculation_engine.py | ★ calculate_metric (X=A/B / 1−A/B), map_to_level | актуальный (используется в reports/excel) |
| llm_service.py | ★ встроенная LLM: load/complete/generate_summary + grounding-guard | актуальный |
| excel_importer.py | импорт каталога/матриц из xlsx | актуальный |
| calculator.py | расчёт метрик | ДУБЛЬ calculation_engine — см. [[04_Зависимости]] |
| assessment.py, system.py, auth.py, templates.py | сервисный слой | проверить актуальность (возможно частично legacy) |

## 5. Конфигурация и безопасность
- `core/config.py::Settings` — из `.env`; LLM-параметры; `security_issues()` (фейл-фаст в проде).
- `core/security.py` — bcrypt(12), JWT с проверкой типа токена (access/refresh).
- `api/deps.py::require_role` — **актуальный** механизм RBAC (используется роутерами).
- `core/rbac.py::require_roles` — параллельный механизм, в роутерах не используется → кандидат на удаление.

## 6. Фоновые задачи (`workers/tasks.py`, Celery+Redis)
- `parse_excel_task` — асинхронный парсинг Excel (вызывается из `/excel/upload`).
- `generate_ai_summary_task` — генерация AI-резюме через `llm_service` (in-process, без Ollama).
