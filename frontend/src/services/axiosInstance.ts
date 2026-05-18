Axios с JWT interceptors:
- Request: Authorization: Bearer <accessToken> из Redux store
- Response 401: проверяет _isRefreshing флаг
  - Если уже refreshing: добавляет в _refreshSubscribers очередь → ждёт нового токена
  - Если нет: POST /auth/refresh → dispatch(setCredentials) → _onRefreshed(newToken) → повторяет исходный запрос
- Провал refresh: dispatch(clearCredentials) → redirect /login
- Защита: /auth/refresh URL исключён из retry-логики (предотвращение бесконечной петли)

## frontend/src/pages/NewAssessmentPage.tsx
- useGetSystemsQuery({is_active: true}) → Select с поиском (showSearch, optionFilterProp)
- Опции периодов: текущий год + прошлый год, Q1-Q4, порядок: новые первые
- Form validation: system_id required, period required
- 409 Conflict → inline Alert (не toast), closable
- Успех → message.success + navigate(`/assessments/${result.id}/input`)

## frontend/src/pages/AdminFlagsPage.tsx
Feature Flags управление:
- Switch компоненты для 6 флагов из flags.yaml
- FEATURE_MONITORING_INTEGRATION: locked=true (disabled Switch + Tag LOCKED)
- changedFlags Set → Alert "изменено N флагов"
- Группировка по категориям: auth, integration, ai, export
- Системная информация (Descriptions): версия, методология, AI модель, JWT TTL
- Статус компонентов (Badge): PG, Redis, Celery, Ollama (зависит от FEATURE_AI_SUMMARY)
