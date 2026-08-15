---
tags:
  - бэк
---

# АСОК ИС — Backend Итерация 2: systems API, reports, excel upload, seeds, tests
**Дата:** 2026-05-17 | **Итерация:** 2

## backend/app/api/v1/systems.py
CRUD для справочника ИС:
- GET /systems — список с фильтрацией (status_lc, criticality_class, is_active) + пагинация
- POST /systems — создание (ADMIN only), проверка уникальности code
- PATCH /systems/{id} — частичное обновление (exclude_unset=True)
- DELETE /systems/{id} — Soft Delete через system.soft_delete()
- Все мутации → AuditLog (action: CREATE/UPDATE/DELETE)

## backend/app/api/v1/reports.py
Экспорт отчётности:
- GET /reports/{period_id}/xlsx — Excel через openpyxl, RAG-заливка ячеек уровня качества, агрегатная строка по уровням
- GET /reports/{period_id}/json — JSON с meta + metrics
- GET /reports/{period_id}/csv — CSV с UTF-8 BOM для MS Excel
- PDF отключён за Feature Flag FEATURE_PDF_REPORTS
- StreamingResponse для всех форматов (не буферизует в памяти сервера)
- RAG цвета: Высокий=FF52C41A, Выше ср.=FF73D13D, Средний=FFFAAD14, Ниже ср.=FFFA8C16, Низкий=FFF5222D, Нет=FFD9D9D9

## backend/app/api/v1/excel_upload.py
- POST /excel/upload — multipart/form-data (period_id + file)
- Валидация: только .xlsx, max 10 МБ
- Сохранение с uuid-префиксом для изоляции параллельных загрузок
- parse_excel_task.delay() → возвращает {task_id}
- GET /excel/tasks/{task_id} — статус через Celery AsyncResult (PENDING/STARTED/COMPLETED/FAILED)

## backend/scripts/seed_metrics.py
28 метрик МК_8.1 по 9 характеристикам ISO 25010:
1. Функциональная пригодность (3): полнота, корректность, уместность
2. Производительность (3): временная эффективность, ресурсы, пропускная способность
3. Совместимость (2): сосуществование, взаимодействие
4. Удобство использования (3): распознаваемость, обучаемость, защита от ошибок
5. Надёжность (4): зрелость, доступность, отказоустойчивость, восстанавливаемость
6. Безопасность (4): конфиденциальность, целостность, неотказуемость, аутентичность
7. Сопровождаемость (4): модульность, повторное использование, анализируемость, тестируемость
8. Переносимость (3): адаптируемость, устанавливаемость, замещаемость
9. Качество данных (2): полнота данных, актуальность данных

Запуск: `python -m scripts.seed_metrics`
Идемпотентен: пропускает существующие по id.

## backend/scripts/seed_demo.py
Демо-данные при DEMO_MODE=true:
- 4 пользователя: demo/manager, analyst/analyst, cto/cto, admin/admin123
- 5 ИС: АБС (MISSION CRITICAL), ДБО (MISSION CRITICAL), CRM (BUSINESS CRITICAL), ХД (BUSINESS CRITICAL), СЭД (BUSINESS OPERATIONAL)
- 4 периода: Q1-2025, Q2-2025, Q3-2025, Q4-2025
- 28 метрик × 5 ИС × 4 периода = 560 AssessmentValue записей
- Реалистичный разброс через _generate_realistic_values() с gaussian noise
- Демо-комментарии для AI-резюме по низким показателям

Запуск: `python -m scripts.seed_demo`
Идемпотентен.

## backend/tests/test_calculator.py
pytest покрытие расчётного ядра:

Классы тестов:
- TestCalculateXDirect: perfect score, граничные 0.81/0.61/0.41/0.21, clamp>1, округление 4 знака
- TestCalculateXInverse: ноль дефектов→1.0, половина→0.5, все дефекты→0.0, clamp<0
- TestEdgeCases: b=0 (DIRECT/INVERSE), a=None, b=None, оба None, неверный formula_type→ValueError
- TestBoundaryValues: @pytest.mark.parametrize — 11 контрольных пар из эталонного Excel

Критерий приёмки: все граничные значения с abs=0.0001 точностью.
