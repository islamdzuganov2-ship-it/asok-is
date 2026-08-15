---
tags:
  - фронт
---

# АСОК ИС — Frontend Итерация 2: Dashboard, ExpertReview
**Дата:** 2026-05-17 | **Итерация:** 2

## frontend/src/pages/DashboardPage.tsx
Компоненты дашборда:

### GlobalHealthDonut (ECharts Pie/Donut)
- radius: ['40%', '70%'] — donut форма
- Цвета по RAG: зелёный ≥0.81, жёлтый 0.41-0.80, красный <0.41
- legend: vertical left, tooltip с процентами
- window resize handler + chart.dispose() в cleanup

### HeatmapMatrix (ECharts Heatmap)
- Ось X: 9 характеристик ISO 25010
- Ось Y: Информационные системы
- visualMap: 0-5 (Невозможно измерить → Высокий)
- Цветовая шкала от красного к тёмно-зелёному
- Высота: max(300, systems.length * 40 + 100) — адаптивная

### ProblematicSystemsList
- Ant Design Table топ-3 ИС по числу низких метрик
- Теги критичности: MISSION CRITICAL → red, BUSINESS CRITICAL → orange
- Число низких метрик → Text type="danger"

### Компоновка
- Row/Col с gutter=[16,16]
- Donut (Col lg={10}) + Проблемные ИС (Col lg={14})
- Heatmap на всю ширину (Col xs={24})
- AiInsightBanner внизу

Skeleton loading при isLoading из useGetSystemsQuery

## frontend/src/pages/ExpertReviewPage.tsx
Экран QUALITY_MANAGER:

### Таблица метрик
- Колонки: ID, X (4 знака), Уровень (Tag с RAG цветом), Комментарий, Источник, Кнопка "Судить"
- rowClassName: строки с Низким/Ниже среднего → ant-table-row-danger

### Modal IExpertJudgment
- Открывается по кнопке "Судить" (EditOutlined)
- Показывает текущий уровень и X в шапке
- Form поля:
  1. adjusted_level — Select с 7 вариантами (эмодзи RAG + текст), required
  2. justification_text — TextArea 4 строки, min 10 символов, maxLength 5000, showCount, required
  3. linked_risk_task — Input опциональный, placeholder Jira URL
- Кнопка "Применить корректировку": type=primary, loading при isSubmitting
- destroyOnClose + form.resetFields() при закрытии

### Обработка ответа
- useCreateExpertJudgmentMutation → unwrap()
- Успех → message.success + закрытие модала
- Ошибка → message.error
- RTK Query автоматически инвалидирует теги Metrics + ExpertJudgments → refetch таблицы

## Роутинг (App.tsx — не сгенерирован, структура)
```typescript
// routes:
// /login → LoginPage (public)
// /dashboard → DashboardPage (auth)
// /assessments/new → NewAssessmentPage (ANALYST+)
// /assessments/:id/input → MetricsInputPage (ANALYST+)
// /assessments/:id/review → ExpertReviewPage (MANAGER+)
// /admin/flags → AdminFlagsPage (ADMIN)
// * → Navigate to /dashboard
```

## Следующие компоненты для разработки
- [ ] AdminFlagsPage.tsx — Feature Flags панель
- [ ] NewAssessmentPage.tsx — выбор ИС + периода, валидация перекрытия
- [ ] App.tsx — роутинг + ProtectedRoute по роли
- [ ] axiosInstance.ts — Axios interceptors для auto-refresh токена
- [ ] frontend/Dockerfile + nginx.conf
- [ ] backend/Dockerfile
- [ ] .env.example
- [ ] backend/requirements.txt
