---
tags:
  - фронт
---

# АСОК ИС — Frontend Итерация 3: App, Layout, Axios, NewAssessment, AdminFlags
**Дата:** 2026-05-17 | **Итерация:** 3 (финальная)

## frontend/src/App.tsx
Корневой компонент:
- React Router v6 с lazy-loading страниц (Suspense + PageLoader spinner)
- RequireAuth: редирект на /login если !isAuthenticated
- RequireRole: проверка allowedRoles, редирект на /dashboard при несоответствии
- AntD ConfigProvider: корпоративная тема (colorPrimary: '#1F3864'), locale ruRU

Маршруты:
| Путь | Роли | Компонент |
|---|---|---|
| /login | public | LoginPage |
| /dashboard | все | DashboardPage |
| /assessments/new | ANALYST, MANAGER, ADMIN | NewAssessmentPage |
| /assessments/:id/input | ANALYST, MANAGER, ADMIN | MetricsInputPage |
| /assessments/:id/review | MANAGER, ADMIN | ExpertReviewPage |
| /admin/flags | ADMIN | AdminFlagsPage |
| * | → /dashboard | Navigate |

## frontend/src/components/AppLayout.tsx
Ant Design Sider (тёмно-синий #1F3864) + Header:
- Меню RBAC: аналитику — создание периода; ADMIN — администрирование
- Header: роль пользователя в виде цветного Tag + Dropdown с кнопкой Выйти
- clearCredentials() + navigate('/login') при логауте
- Collapsible sidebar

## frontend/src/services/axiosInstance.ts
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
