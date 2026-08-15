---
tags:
  - фронт
---

# АСОК ИС — Три новые фичи Frontend
**Дата:** 2026-05-20 | **Статус:** проектир       
## Фичи
1. Создание системы прямо на экране новой оценки (inline modal)
2. Добавление метрики в каталог до формирования периода (inline drawer)
3. Excel upload-блок на экране ввода метрик (импорт в текущую оценку)

## Затронутые файлы
- frontend/src/pages/NewAssessmentPage.tsx — фича 1
- frontend/src/components/CreateSystemModal.tsx — новый
- frontend/src/pages/MetricsInputPage.tsx — фича 3
- frontend/src/components/ExcelUploadBlock.tsx — новый
- frontend/src/pages/AdminPage.tsx или отдельный компонент — фича 2
- frontend/src/components/AddMetricDrawer.tsx — новый
- frontend/src/store/api/assessmentApi.ts — новые endpoints
- backend/app/api/v1/endpoints/systems.py — POST /systems
- backend/app/api/v1/endpoints/metrics.py — POST /metrics/catalog
- backend/app/api/v1/excel_upload.py — уже есть
