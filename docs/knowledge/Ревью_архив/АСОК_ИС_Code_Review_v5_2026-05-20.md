---
tags:
  - фронт
  - бэк
---

# Code Review v5 — АСОК ИС (полный анализ кода)
**Дата:** 2026-05-20 | **Статус:** backend не стартует, frontend не запущен

## Реальная структура проекта (35 Python файлов)

```
backend/app/
├── init_db.py
├── main.py                    ← ПРОБЛЕМА: несогласован с api.py
├── api/
│   ├── deps.py
│   ├── v1/
│   │   ├── api.py             ← импортирует systems которого нет в main
│   │   ├── excel_upload.py
│   │   ├── reports.py
│   │   └── endpoints/
│   │       ├── assessments.py ← заглушки (return [])
│   │       ├── auth.py        ← нужно проверить
│   │       ├── metrics.py     ← исправлен
│   │       └── systems.py     ← заглушка
├── core/
│   ├── config.py              ← JWT_SECRET_KEY (не JWT_SECRET)
│   ├── database.py
│   ├── rbac.py                ← исправлен
│   └── security.py            ← decode_token добавлен
├── db/
│   ├── base.py
│   └── session.py
├── models/
│   ├── assessment.py, audit.py, base_mixin.py
│   ├── metric_catalog.py, system.py, user.py
├── schemas/
│   ├── assessment.py          ← camelCase поля (не snake_case)
│   ├── auth.py                ← TokenPayload добавлен ✅
│   ├── common.py              ← PaginatedResponse
│   └── metric.py              ← MetricCatalogResponse ✅
├── scripts/
│   ├── init_db.py, seed_demo.py, seed_metrics.py
├── services/
│   ├── assessment.py, auth.py, calculation_engine.py
│   ├── calculator.py, system.py
└── workers/
    └── tasks.py               ← текст вместо кода, СЛОМАН

frontend/
├── package.json               ← Vite + React 18 + AntD + ECharts ✅
```

## Найденные проблемы

| # | Файл | Проблема | Приоритет |
|---|---|---|---|
| 1 | main.py vs api.py | Несогласованный список endpoints | 🔴 BLOCKER |
| 2 | workers/tasks.py | Текст вместо Python кода | 🔴 BLOCKER |
| 3 | docker-compose.yml | Нет restart:unless-stopped → контейнер исчезает | 🔴 BLOCKER |
| 4 | .env.example | JWT_SECRET вместо JWT_SECRET_KEY | 🟡 WARN |
| 5 | schemas/assessment.py | camelCase поля (фронтенд ожидает snake_case) | 🟡 WARN |
| 6 | endpoints/assessments.py | return [] заглушка | 🟡 WARN |
| 7 | endpoints/systems.py | return [] заглушка | 🟡 WARN |
| 8 | .gitlab-ci.yml | Не YAML | 🟡 WARN |

## Исправленные файлы (этот сеанс)

- ✅ schemas/auth.py — добавлен TokenPayload
- ✅ core/security.py — добавлен decode_token
- ✅ core/rbac.py — добавлен require_any_authenticated
- ✅ api/v1/endpoints/metrics.py — убраны конфликтующие слои
- ✅ main.py — согласован с api.py, единый api_router
- ✅ api/v1/api.py — убран сломанный import systems
- ✅ workers/tasks.py — заменён рабочим кодом
- ✅ docker-compose.yml — restart:unless-stopped, redis healthcheck, celery_worker

## Команды проверки после исправлений

```powershell
docker compose down -v
docker compose up -d --build
Start-Sleep -Seconds 25
docker ps --format "table {{.Names}}`t{{.Status}}"
docker logs asok_backend --tail=20

# Если backend стартовал:
Invoke-RestMethod -Uri "http://localhost:8000/health"
docker exec asok_backend alembic upgrade head
docker exec asok_postgres psql -U asok_user -d asok_is -c "\dt"
```

## Следующие файлы для чтения

```powershell
Get-Content "backend\app\api\v1\endpoints\auth.py"
Get-Content "backend\app\api\v1\endpoints\assessments.py"
Get-Content "backend\app\core\database.py"
Get-Content "backend\app\api\deps.py"
Get-Content "backend\app\models\user.py"
Get-Content "backend\app\services\auth.py"
Get-Content "backend\alembic\versions\001_initial_schema.py"
```

## Frontend стек (подтверждён)
Vite + React 18 + TypeScript + AntD 5 + ECharts + RTK + axios
VITE_API_BASE_URL — переменная правильная для Vite
Порт 3000 — правильный
