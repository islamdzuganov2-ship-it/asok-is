---
tags:
  - фронт
  - бэк
---

# Code Review — АСОК ИС (реальный репо)
**Дата:** 2026-05-18 | **Репо:** https://github.com/islamdzuganov2-ship-it/asok-is | **Коммитов:** 1

---

## Что реально есть в репо

| Файл | Статус | Проблема |
|---|---|---|
| docker-compose.yml | ✅ Есть, 83 строки | 4 баги внутри |
| .env.example | ✅ Есть, 14 строк | sync DB URL |
| .gitlab-ci.yml | ❌ ФЕЙК | 19 строк markdown-текста, не YAML |
| backend/ | ❓ Структура есть | Содержимое не верифицировано |
| frontend/ | ❓ Структура есть | VITE vs CRA расхождение |

---

## 🔴 BLOCKERS

### BUG-01: .gitlab-ci.yml — не YAML
Файл содержит markdown-текст вместо YAML. GitLab отвергнет при первом пуше.
**Fix:** заменить на рабочий YAML (полный код в разделе ревью).

### BUG-02a: docker-compose.yml — Redis без healthcheck
`condition: service_started` → race condition. Backend стартует до готовности Redis.
```yaml
# Fix: добавить healthcheck в redis:
healthcheck:
  test: ["CMD", "redis-cli", "ping"]
  interval: 10s
  retries: 5
# И в depends_on backend:
redis:
  condition: service_healthy
```

### BUG-02b: Нет alembic upgrade head при старте
```yaml
# Fix command backend:
command: >
  sh -c "alembic upgrade head &&
         python -m scripts.seed_metrics &&
         uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload"
```

### BUG-02c: VITE_API_BASE_URL vs REACT_APP_API_BASE_URL
Frontend использует VITE переменную, но стек — React (CRA). Нужно синхронизировать с package.json.

### BUG-02d: Нет celery_worker сервиса
Без Celery worker Excel-импорт и AI-резюме не работают. Добавить сервис celery_worker в compose.

### BUG-03: .env.example — sync DB URL для async кода
```env
# ❌ Сейчас:
DATABASE_URL=postgresql://user:pass@localhost:5432/asok_is
# ✅ Fix:
DATABASE_URL=postgresql+asyncpg://user:pass@localhost:5432/asok_is
```

---

## 🟡 WARNINGS

### WARN-01: Хардкод user в healthcheck postgres
```yaml
# ❌: pg_isready -U asok_user
# ✅: pg_isready -U ${POSTGRES_USER:-asok_user}
```

### WARN-02: curl в alpine образах
curl не установлен в node:alpine. Healthcheck упадёт.

### WARN-03: Отсутствуют Feature Flag переменные в .env.example
Добавить: FEATURE_AI_SUMMARY, FEATURE_LDAP_AUTH, FEATURE_JIRA_INTEGRATION, FEATURE_PDF_REPORTS

### WARN-04: GitHub repo + GitLab CI = несогласованность платформ
.gitlab-ci.yml в GitHub-репо не запустится. Либо перенести на GitLab, либо добавить .github/workflows/.

---

## 🔵 NOTES

- Text Document.txt в корне — удалить мусор
- .vscodeextensions.json, .vscodesettings.json, .vscodelaunch.json — переименовать в .vscode/extensions.json и т.д.
- Нет .dockerignore и .gitignore — Docker включает node_modules, __pycache__, .env в образы

---

## Сводная таблица приоритетов

| #       | Файл               | Проблема                          | Приоритет  | Трудоёмкость |
| ------- | ------------------ | --------------------------------- | ---------- | ------------ |
| BUG-01  | .gitlab-ci.yml     | Весь файл не YAML                 | 🔴 BLOCKER | 30 мин       |
| BUG-02a | docker-compose.yml | Redis без healthcheck             | 🔴 BLOCKER | 5 мин        |
| BUG-02b | docker-compose.yml | Нет alembic при старте            | 🔴 BLOCKER | 5 мин        |
| BUG-02c | docker-compose.yml | VITE vs REACT_APP                 | 🔴 BLOCKER | 5 мин        |
| BUG-02d | docker-compose.yml | Нет celery_worker                 | 🔴 BLOCKER | 15 мин       |
| BUG-03  | .env.example       | Sync DSN для async                | 🔴 BLOCKER | 2 мин        |
| WARN-01 | docker-compose.yml | Хардкод user в healthcheck        | 🟡 WARN    | 2 мин        |
| WARN-02 | docker-compose.yml | curl в alpine                     | 🟡 WARN    | 5 мин        |
| WARN-03 | .env.example       | Нет Feature Flag vars             | 🟡 WARN    | 5 мин        |
| WARN-04 | .gitlab-ci.yml     | GitHub + GitLab несогласованность | 🟡 WARN    | —            |
| NOTE-01 | Text Document.txt  | Мусор в корне                     | 🔵 NOTE    | 1 мин        |
| NOTE-02 | .vscode*           | Неправильное расположение         | 🔵 NOTE    | 5 мин        |
| NOTE-03 | —                  | Нет .dockerignore/.gitignore      | 🔵 NOTE    | 10 мин       |

---

## Gate для перехода на Frontend

Gate 1 — инфраструктура:
- [ ] BUG-01: .gitlab-ci.yml рабочий YAML
- [ ] BUG-02b: docker compose up поднимает с миграциями
- [ ] BUG-02d: Celery worker в compose
- [ ] BUG-03: postgresql+asyncpg DSN

Gate 2 — backend API контракт:
- [ ] POST /api/v1/auth/login → JWT
- [ ] GET /api/v1/systems → список ИС
- [ ] POST /api/v1/assessments → создание периода
- [ ] GET /api/v1/assessments/{id}/metrics → метрики
- [ ] PUT /api/v1/metrics/{id} → пересчёт X

Без Gate 2 фронт будет на моках → полный рефактор при подключении API = технический долг.

Рекомендация: Спринт 1 (3-4 дня) — закрыть все BUG-*. Спринт 2 — Frontend на реальном контракте.
