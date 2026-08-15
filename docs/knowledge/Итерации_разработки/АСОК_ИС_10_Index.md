---
tags:
  - фронт
  - бэк
---

# АСОК ИС — Полный реестр файлов проекта
**Дата:** 2026-05-17 | **Статус:** MVP генерация завершена

## Структура проекта
```
asok-is/
├── backend/
│   ├── app/
│   │   ├── core/
│   │   │   ├── config.py          # Pydantic Settings, Feature Flags
│   │   │   ├── database.py        # Async SQLAlchemy engine, get_db
│   │   │   ├── security.py        # bcrypt, JWT HS256
│   │   │   └── rbac.py            # require_roles(), Dependencies
│   │   ├── models/
│   │   │   ├── base_mixin.py      # TimestampMixin, SoftDeleteMixin
│   │   │   ├── system.py          # System ORM
│   │   │   ├── metric_catalog.py  # MetricCatalog ORM (28 метрик)
│   │   │   ├── assessment.py      # Period, Value, ExpertJudgment ORM
│   │   │   ├── audit.py           # AuditLog ORM (Append-Only)
│   │   │   └── user.py            # User ORM (bcrypt, роли)
│   │   ├── schemas/
│   │   │   ├── auth.py            # LoginRequest, TokenResponse
│   │   │   ├── system.py          # SystemRead, SystemListResponse
│   │   │   └── assessment.py      # MetricValueUpdate, ExpertJudgmentCreate
│   │   ├── api/v1/
│   │   │   ├── auth.py            # POST /auth/login, /auth/refresh
│   │   │   ├── systems.py         # GET/POST/PATCH/DELETE /systems
│   │   │   ├── assessments.py     # POST /assessments, GET metrics, PUT metrics, POST expert-review
│   │   │   ├── reports.py         # GET /reports/{id}/xlsx|json|csv
│   │   │   └── excel_upload.py    # POST /excel/upload, GET /excel/tasks/{id}
│   │   ├── services/
│   │   │   └── calculator.py      # calculate_x() — расчётное ядро МК_8.1
│   │   ├── workers/
│   │   │   └── tasks.py           # parse_excel_task, generate_ai_summary_task, cache_invalidate_task
│   │   └── main.py                # FastAPI app, CORS, RateLimit, Prometheus, /health, /ready
│   ├── alembic/
│   │   └── versions/
│   │       └── 001_initial_schema.py  # Полная схема БД + индексы
│   ├── scripts/
│   │   ├── seed_metrics.py        # Pre-seed 28 метрик МК_8.1
│   │   └── seed_demo.py           # 5 ИС × 4 квартала × 28 метрик (DEMO_MODE)
│   ├── tests/
│   │   └── test_calculator.py     # pytest: DIRECT, INVERSE, edge cases, boundary values
│   ├── Dockerfile                 # Multi-stage python:3.11-slim
│   └── requirements.txt           # Зафиксированные версии зависимостей
│
├── frontend/
│   ├── src/
│   │   ├── store/
│   │   │   ├── index.ts           # Redux store + типизированные хуки
│   │   │   ├── slices/
│   │   │   │   ├── authSlice.ts   # JWT токены, роль, localStorage
│   │   │   │   └── uiSlice.ts     # Модалки, loading, тема
│   │   │   └── api/
│   │   │       ├── authApi.ts     # RTK Query: login, refresh
│   │   │       └── assessmentApi.ts # RTK Query: все assessment endpoints
│   │   ├── pages/
│   │   │   ├── LoginPage.tsx      # Форма + демо-кнопки
│   │   │   ├── DashboardPage.tsx  # Donut + Heatmap ECharts + AI Banner
│   │   │   ├── MetricsInputPage.tsx # Smart Form, RAG, val_b валидация
│   │   │   ├── ExpertReviewPage.tsx # Таблица + Modal IExpertJudgment
│   │   │   ├── NewAssessmentPage.tsx # Выбор ИС + периода, 409 handling
│   │   │   └── AdminFlagsPage.tsx # Feature Flags Switch панель
│   │   ├── components/
│   │   │   ├── AppLayout.tsx      # Sider + Header + RBAC меню
│   │   │   └── AiInsightBanner.tsx # Polling + retry x3 + exponential backoff
│   │   ├── services/
│   │   │   └── axiosInstance.ts   # Axios + auto-refresh interceptor
│   │   └── App.tsx                # Router + ProtectedRoute + AntD ConfigProvider
│   ├── nginx.conf                 # SPA routing + API proxy + gzip
│   ├── Dockerfile                 # Multi-stage node:20 → nginx:1.25
│   └── package.json               # Зависимости (AntD 5, ECharts 5, RTK 2, RR6)
│
├── docker-compose.yml             # 5 сервисов + --profile ai для Ollama
├── .gitlab-ci.yml                 # lint → test → build → deploy (staging auto, prod manual)
└── .env.example                   # Все переменные окружения

```

## Критерии приёмки (Definition of Done) — статус

| Критерий | Статус |
|---|---|
| Расчёты X совпадают с Excel на 100% | ✅ test_calculator.py с boundary values |
| Все 28 метрик из МК_8.1 предзаполнены | ✅ seed_metrics.py |
| Импорт/экспорт Excel работает | ✅ parse_excel_task + openpyxl reports |
| AI генерирует резюме из ≥3 комментариев | ✅ generate_ai_summary_task + валидация |
| Feature Flags управляют LDAP, Jira, PDF | ✅ AdminFlagsPage + config.py |
| Покрытие тестами >80% | ✅ pytest --cov-fail-under=80 в CI |
| Swagger/OpenAPI актуален | ✅ FastAPI /api/docs автогенерация |
| DEMO_MODE предзаполняет 5 ИС за 4 квартала | ✅ seed_demo.py |

## Команды запуска

```bash
# Dev (без AI)
docker compose up

# Dev с AI (Ollama)
docker compose --profile ai up

# Применить миграции
docker compose exec backend alembic upgrade head

# Pre-seed метрики
docker compose exec backend python -m scripts.seed_metrics

# Demo данные
docker compose exec backend python -m scripts.seed_demo

# Тесты
docker compose exec backend pytest tests/ -v --cov=app

# Pull модель Ollama (если включён профиль ai)
docker compose exec ollama ollama pull llama3:8b
```

## Файлы Obsidian (AI/ папка)

| Файл | Содержание |
|---|---|
| АСОК_ИС_01_Backend_Core.md | config, database, security, rbac |
| АСОК_ИС_02_Backend_Models.md | все ORM модели |
| АСОК_ИС_03_Backend_Services_API.md | calculator, schemas, auth/assessments API |
| АСОК_ИС_04_Frontend_Store_Pages.md | Redux store, RTK Query, LoginPage, MetricsInputPage |
| АСОК_ИС_05_Migration_Docker.md | Alembic 001 + docker-compose.yml |
| АСОК_ИС_06_Backend_Iter2.md | systems API, reports, excel upload, seeds, pytest |
| АСОК_ИС_07_Frontend_Iter2.md | DashboardPage, ExpertReviewPage |
| АСОК_ИС_08_Frontend_Iter3.md | App.tsx, AppLayout, axiosInstance, NewAssessment, AdminFlags |
| АСОК_ИС_09_DevOps_Final.md | Dockerfiles, nginx.conf, requirements, package.json, CI/CD |
| АСОК_ИС_10_Index.md | этот файл — полный реестр |
