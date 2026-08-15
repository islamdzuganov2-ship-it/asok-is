---
tags:
  - фронт
  - бэк
---

# Code Review v4 — АСОК ИС (финальный срез)
**Дата:** 2026-05-20 | **Коммитов:** 1 | **Статус:** backend не стартует

## Реальное состояние файлов по результатам чтения

### docker-compose.yml (83 строки) — прочитан полностью
- ✅ asyncpg DSN правильный
- ✅ postgres Healthy + healthcheck
- ❌ redis: condition: service_started (не исправлено)
- ❌ нет celery_worker (не добавлен)
- ❌ нет alembic upgrade head в command backend
- ❌ curl в healthcheck backend (нет в python:slim)

### .env.example (14 строк)
- ❌ DATABASE_URL=postgresql:// (sync, не asyncpg) — расходится с compose
- ❌ JWT_SECRET (но в security.py используется JWT_SECRET_KEY)
- ❌ нет Feature Flag переменных

### .gitlab-ci.yml (19 строк) — НЕ YAML
- ❌ markdown-текст, CI/CD полностью сломан

### backend/app/core/security.py
- ✅ bcrypt, create_access_token, create_refresh_token
- ❌ нет decode_token — rbac.py его импортирует → ImportError

### backend/app/core/rbac.py  
- ✅ get_current_token, require_roles структура правильная
- ❌ from app.schemas.auth import TokenPayload — TokenPayload не существует в schemas/auth.py
- ❌ нет require_any_authenticated — metrics.py его требует

### backend/app/schemas/auth.py
- ❌ нет TokenPayload класса

### backend/app/api/v1/endpoints/metrics.py
- ❌ три конфликтующих слоя кода в одном файле
- ❌ два router = APIRouter() (второй перезаписывает первый)
- ❌ get_current_user используется но не определена корректно

### backend/app/api/v1/endpoints/assessments.py
- ❌ только заглушки (return [])
- ❌ нет роутера с prefix

### backend/app/api/v1/endpoints/systems.py
- ❌ SystemResponse определён прямо в файле (не в schemas)
- ❌ нет роутера с prefix
- ❌ нет реальной логики

## Цепочка ошибок (текущая)
main.py → api.py → metrics.py → rbac.py → schemas/auth.py → TokenPayload не найден

## Следующие команды диагностики
(см. основной документ ревью)
