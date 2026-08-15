---
tags:
  - фронт
  - бэк
---

# АСОК ИС — Gap-анализ на основе реального кода

Дата: 2026-05-28

## Итог: 3 блокера, 5 критичных, 4 работает, 3 доработки

---

## БЛОКЕРЫ (без этого 404/crash)

### 1. Нет эндпоинтов /dashboard/executive, /manager, /analyst
- Фронтенд вызывает три несуществующих роута
- В реальности есть только `GET /assessments/dashboard`
- **Решение:** создать `backend/app/api/v1/dashboard.py` с тремя GET-эндпоинтами

### 2. Нет эндпоинтов для мутаций
- `POST /metrics/{id}/judgment` — модель `ExpertJudgmentHistory` есть, роута нет
- `POST /metrics/{id}/draft` и `/submit` — не существуют
- **Решение:** маппить на существующий `PUT /assessments/{period_id}/metrics`

### 3. Два конфликтующих App.tsx
- `src/App.tsx` (новый — 3 дашборда) vs `src/app/App.tsx` (оригинал — полный роутер)
- Потеряны маршруты: /assessments, /reports, /admin, LoginPage, RequireAuth
- **Решение:** объединить, не заменять

---

## КРИТИЧНЫЕ (данные не придут)

### 4. Формат ответа /assessments/dashboard не совпадает
- `globalHealthScore` — бэкенд 0–1, фронтенд ждёт 0–100
- `problematicSystems` — нет полей `score` и `aiSummary`
- Нет полей `technicalDebtBurndown` и `burndownDetails`

### 5. Нет данных для Manager Dashboard
- Ожидает `selectedSystemName`, `selectedCharacteristicScore`, `metrics[]` с уровнями
- Нужен query-параметр `?system_id=`

### 6. Нет данных для Analyst Dashboard
- Ожидает `characteristicsBySystem` — дерево ISO 25010
- Бэкенд возвращает плоский список `AssessmentValue`

### 7. Store — authApi потерян
- Мой store/index.ts подключает только apiSlice
- authApi (логин) не подключён — логин сломан

### 8. apiSlice.ts — двойное createApi
- Мой apiSlice не содержит хуки для assessments/systems/metrics
- Страницы MetricsInputPage, NewAssessmentPage сломаются

---

## УЖЕ РАБОТАЕТ

- `GET /assessments/dashboard` — полностью реализован
- `calculate_metric()` и `map_to_level()` — корректная логика
- Модели AssessmentValue, ExpertJudgmentHistory, System — готовы
- `config.py` с `extra="ignore"` — Pydantic v2 проблема решена

---

## ПЛАН ИСПРАВЛЕНИЙ (приоритет)

1. Восстановить оригинальный App.tsx из `src/app/App.tsx`, добавить 3 новых роута
2. Добавить authApi обратно в store/index.ts
3. Написать `backend/app/api/v1/dashboard.py` — 3 GET эндпоинта
4. Адаптировать apiSlice.ts — добавить дашборд-эндпоинты к существующим

---

## ДОРАБОТКИ

- axiosInstance и RTK Query — два HTTP-клиента с разными источниками токена
- VITE_API_BASE_URL vs VITE_API_URL — разные env-переменные
