"""
Домен dataio — приём данных: загрузка Excel (каталог метрик, оценки, матрицы),
фоновый парсинг (Celery). Будущее место коннекторов приёма из внешних источников
(СУЗ/ТМС/ITSM/DWH — адаптеры в infrastructure.integrations, контракты в shared.ports).

Публичный фасад (ТЗ v13). Роутер монтируется композиционным корнем из app.modules.dataio.router.
"""
from app.modules.dataio.importer import (
    ImportSummary,
    ensure_period_values,
    get_or_create_default_system,
    get_or_create_metric,
    get_or_create_period,
    import_matrices_from_workbook,
    import_metric_catalog_from_workbook,
    import_quality_timeline,
)
from app.modules.dataio.tasks import parse_excel_task

__all__ = [
    "ImportSummary",
    "ensure_period_values",
    "get_or_create_default_system",
    "get_or_create_metric",
    "get_or_create_period",
    "import_matrices_from_workbook",
    "import_metric_catalog_from_workbook",
    "import_quality_timeline",
    "parse_excel_task",
]
