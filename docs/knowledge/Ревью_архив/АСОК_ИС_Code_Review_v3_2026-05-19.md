---
tags:
  - фронт
  - бэк
---

# Code Review v3 — АСОК ИС (после docker compose up)
**Дата:** 2026-05-19 | **Статус:** система поднялась, 3 blocker остались

---

## Результат docker compose up --build

```
✔ Image asok-is-backend    Built 3.1s
✔ Image asok-is-frontend   Built 3.1s
✔ Network asok-is_asok_net Created
✔ Volume asok-is_pgdata    Created
✔ Volume asok-is_redisdata Created
✔ Container asok_postgres  Healthy  15.8s  ← ✅
✔ Container asok_redis     Started   5.2s  ← ⚠️ нет healthcheck
✔ Container asok_backend   Started  15.8s  ← ⚠️ нет alembic
✔ Container asok_frontend  Started  15.9s  ← ⚠️ VITE? не проверено
```

Отсутствуют: celery_worker, ollama (ожидаемо — профиль ai)

---

## ✅ Что работает

- Оба Dockerfile собрались чисто, слои кэшированы правильно
- PostgreSQL Healthy — таблицы можно создавать
- Сеть и тома созданы
- Layer caching оптимален: COPY requirements.txt → pip install → COPY .

---

## ⚠️ Три активных проблемы

### 1. Redis Started (не Healthy) — race condition
Backend стартует до гарантии готовности Redis.
Первый запрос к кэшу → connection refused.

Fix:
```yaml
redis:
  healthcheck:
    test: ["CMD", "redis-cli", "ping"]
    interval: 10s
    retries: 5

backend:
  depends_on:
    redis:
      condition: service_healthy  # было service_started
```

### 2. Backend без alembic upgrade head — БД пустая
Таблиц нет. POST /auth/login → 500 "relation does not exist".

Fix:
```yaml
command: >
  sh -c "alembic upgrade head &&
         python -m scripts.seed_metrics &&
         uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload"
```

### 3. Нет celery_worker — Excel и AI не работают
parse_excel_task.delay() уйдёт в очередь навсегда.

Fix: добавить сервис celery_worker в compose (код в предыдущих ревью).

---

## Команды проверки (выполнить прямо сейчас)

```powershell
curl http://localhost:8000/health         # → {"status":"ok"}
curl http://localhost:8000/api/docs       # → Swagger HTML
docker logs asok_backend --tail=50        # проверить ошибки миграций
curl http://localhost:3000                # → frontend HTML
```

---

## Следующий шаг

1. Исправить docker-compose.yml (Redis healthcheck + alembic command + celery_worker)
2. Заменить .gitlab-ci.yml рабочим YAML (из АСОК_ИС_Code_Review_2026-05-18.md)
3. Переместить .vscode* в .vscode/
4. docker compose down -v && docker compose up --build
5. Проверить: docker logs asok_backend → "Running upgrade ... Uvicorn running"
6. После зелёного бэка → подключать RTK Query на фронтенде

---

## Gate для фронтенда (не открывать раньше)

- [ ] curl /health → 200
- [ ] curl /api/docs → Swagger с реальными роутами
- [ ] curl /api/v1/auth/login → JWT токен (не 500)
- [ ] docker logs → нет "relation does not exist"
