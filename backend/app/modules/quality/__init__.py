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
from app.modules.quality.models import (
    FormulaType,
    MetricAttribute,
    MetricCatalog,
    MetricCharacteristic,
    ScoreHistorySnapshot,
    WeightSetVersion,
)
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
from app.modules.quality.scoring import (
    PortfolioScoreBreakdown,
    SubcharScore,
    SystemScoreBreakdown,
    measure_weight,
    portfolio_score,
    weighted_system_score,
)
from app.modules.quality.weight_versions import (
    DEFAULT_CRITICALITY_WEIGHTS,
    PeriodScoreDelta,
    RecomputeReport,
    combined_weights_for_version,
    ensure_active_version,
    get_active_version,
    list_versions,
    preview_weight_edit,
    recompute_and_snapshot,
    save_weight_edit,
    validate_weight_edit,
    weight_for,
)
from app.modules.quality.weights import (
    CHARACTERISTIC_WEIGHTS,
    CRITICALITY_PROFILES,
    DEFAULT_CHAR_WEIGHTS,
    DEFAULT_SUBCHAR_WITHIN_CHAR,
    SUBCHAR_WEIGHTS,
    subchar_weight,
)

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
    # ТЗ v19 УК-04..07: веса, свёртка, версии/история
    "SUBCHAR_WEIGHTS",
    "CHARACTERISTIC_WEIGHTS",
    "subchar_weight",
    "SubcharScore",
    "SystemScoreBreakdown",
    "PortfolioScoreBreakdown",
    "weighted_system_score",
    "portfolio_score",
    "WeightSetVersion",
    "ScoreHistorySnapshot",
    "DEFAULT_CRITICALITY_WEIGHTS",
    "RecomputeReport",
    "PeriodScoreDelta",
    "get_active_version",
    "ensure_active_version",
    "list_versions",
    "recompute_and_snapshot",
    "combined_weights_for_version",
    "weight_for",
    "validate_weight_edit",
    "save_weight_edit",
    "preview_weight_edit",
    "CRITICALITY_PROFILES",
    "DEFAULT_CHAR_WEIGHTS",
    "DEFAULT_SUBCHAR_WITHIN_CHAR",
    # ТЗ v19 УК-13 (п.13): вес меры для нагрузки/балансировки исполнителей
    "measure_weight",
]
