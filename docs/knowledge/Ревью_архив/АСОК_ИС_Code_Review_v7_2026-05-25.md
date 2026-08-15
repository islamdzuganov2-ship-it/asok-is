---
tags:
  - фронт
  - бэк
---

# АСОК ИС — Code Review v7 + Полные исправления
**Дата:** 2026-05-25 | **Коммитов в репо:** 1 (не изменился)

## КРИТИЧЕСКАЯ СИТУАЦИЯ
Репо не обновлялся с первого коммита. Все исправления из сессий 1-6 существуют только локально. Нужен git push.

```powershell
cd C:\Users\adiga\projects\asok-is
git add .
git commit -m "fix: pydantic extra, db base, auth protocol, systems crud, assessments logic, calculation engine, dashboard"
git push
```

---

## Три активные проблемы (из задания)

### 1. Dashboard не отображается
Причина: GET /systems → [] (заглушка), нет seed-данных, ECharts монтируется до данных.
Fix: systems.py реальный CRUD + seed_metrics.py + DashboardPage с graceful empty state.

### 2. Ввод метрик не работает
Причина: PUT /metrics/{id} не существует на backend, assessment_values пустая.
Fix: assessments.py новый endpoint PUT /assessments/metrics/{value_id} с пересчётом X.

### 3. Login сломан
Причина: OAuth2PasswordRequestForm (form-data) vs JSON от фронтенда.
Fix: auth.py переписан на LoginRequest (JSON body).

---

## Исправленные файлы (v7)

| Файл | Изменение |
|---|---|
| backend/app/api/v1/endpoints/auth.py | JSON вместо form-data, in-memory demo users |
| backend/app/api/v1/endpoints/systems.py | Реальный GET+POST вместо заглушки |
| backend/app/api/v1/endpoints/assessments.py | GET+POST periods, GET+PUT metrics |
| backend/app/services/calculation_engine.py | Decimal расчёт, все уровни МК_8.1 |
| backend/app/api/v1/api.py | systems возвращён в роутер |
| backend/alembic/versions/001_initial_schema.py | Добавлена таблица users |
| backend/app/scripts/seed_metrics.py | 28 метрик МК_8.1, идемпотентный |
| frontend/src/pages/DashboardPage.tsx | Реальные API вызовы, ECharts, empty state |

---

## Карта взаимосвязей

```
LOGIN:    LoginPage → POST /auth/login (JSON) → JWT
DASHBOARD: DashboardPage → GET /systems + GET /assessments/periods → ECharts
METRICS:  MetricsInputPage → GET /assessments/{id}/metrics → PUT /assessments/metrics/{id}
                          → calculate_metric() → quality_level
CHAIN:    users ← (standalone)
          systems → assessment_periods → assessment_values ← metric_catalog
                                      → expert_judgment_history
CELERY:   /excel/upload → parse_excel_task | /ai/summary → generate_ai_summary_task
```

---

## Команды запуска

```powershell
docker compose down -v
docker compose up -d --build
Start-Sleep 20
docker exec asok_backend alembic upgrade head
docker exec asok_backend python -m app.scripts.seed_metrics
Invoke-RestMethod "http://localhost:8000/health"
$r = Invoke-RestMethod "http://localhost:8000/api/v1/auth/login" -Method POST -Body '{"username":"manager","password":"Manager123!"}' -ContentType "application/json"
$token = $r.access_token
Invoke-RestMethod "http://localhost:8000/api/v1/systems" -Headers @{Authorization="Bearer $token"}
```

---

## Точка продолжения при обрыве сессии

В новом чате написать:
"АСОК ИС продолжение. Статус: [backend up/down]. Задача: [что именно]"
Приложить: docker ps + docker logs asok_backend --tail=10 + curl /health

Все решения в Obsidian AI/АСОК_ИС_* — контекст сохранён.

---

## Следующие задачи после текущих исправлений

1. GET /assessments/dashboard — агрегированные данные для heatmap (реальные, не random)
2. Seed demo-данных (5 ИС × 4 квартала) для демонстрации дашборда
3. ExpertReviewPage — POST judgment endpoint
4. Excel upload — проверить что celery_worker подхватывает задачи
5. .gitlab-ci.yml — заменить markdown на рабочий YAML
6. git push — всё что сделано локально
