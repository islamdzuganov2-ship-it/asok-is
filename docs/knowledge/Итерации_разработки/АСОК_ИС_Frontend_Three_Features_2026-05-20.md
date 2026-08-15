---
tags:
  - фронт
---

# АСОК ИС — Frontend три новые фичи (полный код)
**Дата:** 2026-05-20

## Фича 1: CreateSystemModal.tsx
Antd Modal, POST /systems, автовыбор созданной ИС в Select.
Валидация 409 (дубль кода) прямо в форме.
Вызов: кнопка [+] рядом с Select системы в NewAssessmentPage.

## Фича 2: AddMetricDrawer.tsx
Antd Drawer 480px, POST /metrics/catalog.
Предупреждение: метрика войдёт только в новые периоды.
9 характеристик ISO 25010 в Select, DIRECT/INVERSE с описанием.

## Фича 3: ExcelUploadBlock.tsx
Dragger Upload (.xlsx, max 10MB), POST /excel/upload с XHR для progress.
Polling GET /excel/tasks/{task_id} каждые 2 сек, max 60 попыток (2 мин).
Состояния: idle → uploading → polling → completed|failed.
onImported() → refetch() в MetricsInputPage.

## Backend требования
- POST /systems — нет реальной реализации (заглушка), нужна
- POST /metrics/catalog — не существует, нужен новый endpoint
- POST /excel/upload — уже есть в excel_upload.py

## Интеграция в существующие страницы
NewAssessmentPage: Space.Compact (Select + кнопка +), кнопка "Добавить метрику в каталог"
MetricsInputPage: ExcelUploadBlock перед таблицей метрик с onImported → refetch()

## Статус репозитория
Коммит всё ещё 1 — правки из прошлых сессий не залиты.
Перед работой с фичами: git add . && git commit -m "fix: core fixes" && git push
