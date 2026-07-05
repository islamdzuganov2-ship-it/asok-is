"""
Домен quality — модель качества ISO/IEC 25010: каталог метрик, расчёт X/уровня, константы модели.

Публичный фасад (ТЗ v13). Роутер монтируется композиционным корнем из app.modules.quality.router.
Расчётные функции и константы модели используются доменами assessment/reporting/dataio.
"""
from app.modules.quality.ai_calculation import aggregate as ai_aggregate
from app.modules.quality.ai_calculation import compute_metric as ai_compute_metric
from app.modules.quality.ai_calculation import normalize_to_baseline as ai_normalize_to_baseline
from app.modules.quality.ai_quality_model import (
    AI_PAIR_KEYS,
    AI_SUB_INDEX,
    AI_TOTAL_SUBS,
    METRIC_KINDS,
    ai_model_tree,
)
from app.modules.quality.calculation import calculate_metric, map_to_level
from app.modules.quality.models import FormulaType, MetricAttribute, MetricCatalog, MetricCharacteristic
from app.modules.quality.quality_model import (
    ABBR,
    CHARACTERISTICS,
    QUALITY_MODEL,
    QUALITY_PAIR_KEYS,
    QUALITY_PAIRS,
    TOTAL_SUBS,
    canonical_characteristic,
)
from app.modules.quality.schemas import MetricCatalogResponse, MetricCreate, MetricOut, MetricUpdate

__all__ = [
    "MetricCatalog",
    "MetricCharacteristic",
    "MetricAttribute",
    "FormulaType",
    "calculate_metric",
    "map_to_level",
    "QUALITY_MODEL",
    "QUALITY_PAIRS",
    "QUALITY_PAIR_KEYS",
    "TOTAL_SUBS",
    "CHARACTERISTICS",
    "ABBR",
    "canonical_characteristic",
    "MetricCreate",
    "MetricUpdate",
    "MetricOut",
    "MetricCatalogResponse",
    # Контур СИИ по ГОСТ Р 59898-2021 (BL-001):
    "ai_model_tree",
    "AI_SUB_INDEX",
    "AI_PAIR_KEYS",
    "AI_TOTAL_SUBS",
    "METRIC_KINDS",
    "ai_compute_metric",
    "ai_normalize_to_baseline",
    "ai_aggregate",
]
