---
tags:
  - фронт
  - бэк
---
# Code Review v6 — АСОК ИС (финальные исправления)
**Дата:** 2026-05-20 | **Статус:** найдена корневая причина всех падений

## Корневая причина: Pydantic v2 extra inputs not permitted

`docker-compose.yml` передаёт `POSTGRES_PASSWORD=asok_pass123` в контейнер.
`Settings` (Pydantic BaseSettings) без `extra="ignore"` → ValidationError при инициализации.
Убивает: backend + celery одновременно.

## Три файла исправлены

### 1. backend/app/core/config.py
Добавлено: `model_config = ConfigDict(extra="ignore")`

### 2. backend/app/db/base.py  
Было: `from app.db.base_class import Base` (модуль не существует)
Стало: `class Base(DeclarativeBase): pass` + импорты всех моделей

### 3. backend/app/core/database.py
Импорт Base из db.base исправлен, добавлен rollback при исключении

## Текущее состояние после исправлений (ожидаемое)

| Контейнер | Статус | Примечание |
|---|---|---|
| asok_postgres | Healthy | ✅ работает |
| asok_redis | Healthy | ✅ работает |
| asok_backend | Up | ✅ после исправления config |
| asok_celery | Up | ✅ та же причина падения |
| asok_frontend | Up | ✅ уже работает на :3000 |

## Команды после старта
```powershell
docker exec asok_backend alembic upgrade head
docker exec asok_postgres psql -U asok_user -d asok_is -c "\dt"
Invoke-RestMethod "http://localhost:8000/health"
Start-Process "http://localhost:8000/docs"
```

## Таблицы в миграции 001_initial_schema.py
- systems (с Enum: ОЭ, ПЭ, Создание и тестирование)
- metric_catalog (с Enum: DIRECT, INVERSE)
- assessment_periods
- assessment_values
- expert_judgment_history
- НЕТ таблицы users → нужна миграция 002

## Авторизация (in-memory DEMO_USERS)
- admin / Admin123! → role: admin
- analyst / Analyst123! → role: analyst  
- manager / Manager123! → role: manager
- Использует OAuth2PasswordRequestForm (form-data, не JSON)

## Следующие задачи
1. Добавить таблицу users в миграцию (002_add_users.py)
2. Подключить frontend к реальному API (/api/v1/auth/login)
3. Реализовать systems endpoint с реальным запросом к БД
4. Seed 28 метрик в metric_catalog
