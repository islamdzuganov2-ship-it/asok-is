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