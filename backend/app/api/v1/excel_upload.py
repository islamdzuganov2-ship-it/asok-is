 POST /excel/upload — multipart/form-data (period_id + file)
- Валидация: только .xlsx, max 10 МБ
- Сохранение с uuid-префиксом для изоляции параллельных загрузок
- parse_excel_task.delay() → возвращает {task_id}
- GET /excel/tasks/{task_id} — статус через Celery AsyncResult (PENDING/STARTED/COMPLETED/FAILED)