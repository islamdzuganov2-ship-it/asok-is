---
tags: [асок-ис, архитектура, frontend]
date: 2026-06-27
status: baseline
---

# Frontend (React + TypeScript + Vite)

Корень: `frontend/src/`. Точка входа: `main.tsx` → `App.tsx` (Provider Redux + Router).
Сборка: Vite 5 (`vite.config.ts` — прокси `/api`, allowedHosts, alias `@`).

## 1. Структура каталогов
```
frontend/src/
├── main.tsx                # bootstrap: Provider store + <App/>
├── App.tsx                 # ★ роутер, RequireAuth/RequireRole, DashboardRouter, ConfigProvider (тема)
├── components/             # переиспользуемые компоненты (см. §3)
├── pages/                  # экраны (см. §2)
│   └── dashboard/          # ExecutiveDashboard, ManagerDashboard
├── store/                  # Redux Toolkit
│   ├── index.ts            # configureStore (auth, governance, ui, apiSlice)
│   ├── slices/             # authSlice, governanceSlice, uiSlice
│   └── api/                # apiSlice (RTK Query), authApi, assessmentApi
├── data/                   # моки: mockScaleData (★ актуальный), mockDashboards, mockExcelData
├── constants/roles.ts      # ★ подписи ролей (Топ-менеджмент/Менеджер по качеству/Аналитик)
├── theme/ragPalette.ts     # ★ пастельная RAG-палитра, ragToken, critTagStyle
└── services/axiosInstance.ts  # axios (параллельно с fetch/RTK — см. legacy)
```

## 2. Роутинг и страницы (`App.tsx`)
| Путь | Страница | Доступ |
|------|----------|--------|
| `/login` | LoginPage | — |
| `/dashboard` | DashboardRouter (редирект по роли) | auth |
| `/dashboard/executive` | ExecutiveDashboard | Топ-менеджмент |
| `/dashboard/manager` | ManagerDashboard | Менеджер по качеству |
| `/dashboard/analytics` | DashboardPage (аналитический) | все |
| `/assessments/new` | AssessmentWorkspacePage (Новая оценка + Отчёты) | аналитик/менеджер/топ |
| `/assessments/:id/input` | MetricsInputPage | аналитик/менеджер/топ |
| `/assessments/:id/review` | ExpertReviewPage | менеджер/топ |
| `/reports` | ExcelReportsPage | все (back-compat; в меню скрыт) |
| `/risks` | RiskBasePage | все |
| `/admin/flags` | AdminFlagsPage (Настройка) | Топ-менеджмент |

Меню по роли — `components/AppLayout.tsx`.

## 3. Ключевые компоненты (`components/`)
| Компонент | Назначение |
|-----------|-----------|
| AppLayout | каркас: сайдбар (меню по роли), шапка (имя·роль, переключатель Демо/LLM) |
| ExecutiveDashboard / ManagerDashboard / DashboardPage | три дашборда |
| ActionInsightModal | модалка ИС: кто виноват / с кого спрашивать / действия + меры на одобрение |
| MeasureDecisionModal | ★ карточка меры: решение (+коммент), смена ответственного/срока, контроль выполнения |
| MeasuresRegistryCard | реестр мер: фильтры (поиск/система/статус/выполнение/срок), сроки, сортировка |
| TechDebtCard | статус техдолга: 2 burndown + счётчики статусов + выбор периода |
| ProfessionalJudgmentModal | проф. суждение менеджера: обоснование + постановка меры (ответственный ФИО+должность) |
| LevelHeatmap | HTML-теплокарта аналитического дашборда (липкая шапка, единая RAG-палитра) |
| ExcelUploadBlock | загрузка .xlsx |
| ExpertJudgmentModal, AiInsightBanner, TemplatesDisplay | проверить — вероятно legacy (см. [[04_Зависимости]]) |

## 4. Состояние (Redux)
| Слайс | Хранит | Персист |
|-------|--------|---------|
| authSlice | token, role, fullName, isAuthenticated | localStorage (`token`/`role`/`full_name`) |
| governanceSlice | ★ proposals (меры): статус, решение, выполнение, ответственный | localStorage (`asok_governance`), сид из mockScaleData |
| uiSlice | dataMode (mock/live), тема, модалки | localStorage (`asok_data_mode`) |
| apiSlice (RTK Query) | кэш API (системы, периоды, матрицы, импорт) | — |

## 5. Данные/моки (`data/`)
- `mockScaleData.ts` — ★ генератор: 30 ИС × 8 характеристик × 31 подхарактеристика (формулы ГОСТ),
  `EXECUTIVE_SCALE`, `MANAGER_SCALE_SYSTEMS`, `ANALYTICS_SCALE`, `SCALE_PROPOSALS`, `HEATMAP_CHARS_FULL`.
- `mockDashboards.ts` — типы (ExecSystemInsight, ManagerSystem) + старые моки (частично legacy).
- `mockExcelData.ts` — моки Excel (проверить использование).

## 6. Конвенции
- API: относительный `/api/v1` (env `VITE_API_BASE_URL`), запросы через `fetch` или RTK Query.
  ⚠️ Для сборки URL использовать базу: `new URL(path, window.location.origin)` (иначе падает на относительном пути).
- Цвета — только из `theme/ragPalette.ts` (пастель) + тема AntD в `App.tsx`.
- Подписи ролей — только из `constants/roles.ts`.
