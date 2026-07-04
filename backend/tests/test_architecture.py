"""Архитектурные тесты модульного монолита (ТЗ v13, задачи #17–#18).

Закрепляют: (1) легаси-пути слоевого монолита удалены; (2) фасады доменов отдают
публичный API; (3) Dependency Rule: shared/infrastructure не импортируют modules на
уровне модуля, домены не тянут легаси; (4) единый Base и полный реестр моделей;
(5) точка входа celery-воркера жива.
"""
import importlib
from pathlib import Path

import pytest

APP_DIR = Path(__file__).resolve().parents[1] / "app"

LEGACY_MODULES = [
    "app.core.config",
    "app.core.database",
    "app.core.security",
    "app.db.base",
    "app.db.session",
    "app.models.user",
    "app.models.system",
    "app.models.metric_catalog",
    "app.models.assessment",
    "app.models.matrices",
    "app.models.risk_base",
    "app.models.base_mixin",
    "app.schemas.auth",
    "app.schemas.assessment",
    "app.schemas.metric",
    "app.schemas.risk_base",
    "app.services.llm_service",
    "app.services.calculation_engine",
    "app.services.excel_importer",
    "app.constants.quality_model",
    "app.api.deps",
    "app.api.v1.reports",
    "app.api.v1.risk_base",
    "app.api.v1.excel_upload",
    "app.api.v1.endpoints.auth",
]


@pytest.mark.parametrize("module_path", LEGACY_MODULES)
def test_legacy_shim_paths_removed(module_path):
    """Шимы strangler-миграции сняты: старые импорты должны падать (#18)."""
    with pytest.raises(ModuleNotFoundError):
        importlib.import_module(module_path)


FACADE_EXPORTS = {
    "app.modules.iam": ["User", "get_current_user", "require_role", "decode_token"],
    "app.modules.systems": ["System", "CriticalityClass", "LifecycleStatus"],
    "app.modules.quality": ["MetricCatalog", "calculate_metric", "map_to_level",
                            "QUALITY_MODEL", "canonical_characteristic"],
    "app.modules.assessment": ["AssessmentPeriod", "AssessmentValue", "ProfessionalJudgment"],
    "app.modules.risk": ["RiskBase", "search_risks", "risks_for_characteristics"],
    "app.modules.reporting": ["RiskMatrix", "DefectMatrix", "QualityPlanMatrix", "DashboardDataOut"],
    "app.modules.dataio": ["import_matrices_from_workbook", "import_metric_catalog_from_workbook",
                           "ensure_period_values", "get_or_create_metric", "parse_excel_task"],
    "app.modules.llm": ["generate_judgment_conclusion", "generate_reasoned_conclusion",
                        "run_reasoning", "is_available"],
}


@pytest.mark.parametrize("facade, symbols", FACADE_EXPORTS.items())
def test_module_facades_expose_public_api(facade, symbols):
    mod = importlib.import_module(facade)
    missing = [s for s in symbols if not hasattr(mod, s)]
    assert not missing, f"{facade}: фасад не отдаёт {missing}"


def _toplevel_imports_of(path: Path) -> list[str]:
    """Импорты уровня модуля (без отступа): function-local (реестр моделей) разрешены."""
    lines = path.read_text(encoding="utf-8").splitlines()
    return [ln for ln in lines if ln.startswith(("import app.", "from app."))]


def test_shared_and_infrastructure_do_not_import_modules():
    """Dependency Rule: shared/infrastructure не знают о modules (ТЗ v13 §B4)."""
    offenders = []
    for pkg in ("shared", "infrastructure"):
        for py in (APP_DIR / pkg).rglob("*.py"):
            for ln in _toplevel_imports_of(py):
                if "app.modules" in ln:
                    offenders.append(f"{py.relative_to(APP_DIR)}: {ln.strip()}")
    assert not offenders, "\n".join(offenders)


def test_modules_do_not_import_legacy_layers():
    """Домены не тянут удалённые слои (core/db/services/constants/schemas/api.deps)."""
    banned = ("app.core", "app.db", "app.services", "app.constants", "app.schemas", "app.api.deps")
    offenders = []
    for py in (APP_DIR / "modules").rglob("*.py"):
        for ln in _toplevel_imports_of(py):
            if any(b in ln for b in banned):
                offenders.append(f"{py.relative_to(APP_DIR)}: {ln.strip()}")
    assert not offenders, "\n".join(offenders)


def test_single_base_and_full_model_registry():
    """Единый Base: после import_models() в metadata все 13 таблиц контура (ТЗ v13 §B6)."""
    from app.infrastructure.database import Base, import_models
    import_models()
    expected = {
        "users", "systems", "metric_catalog", "metric_characteristics", "metric_attributes",
        "assessment_periods", "assessment_values", "professional_judgments",
        "expert_judgment_history", "risk_matrices", "defect_matrices",
        "quality_plan_matrices", "risk_base",
    }
    assert expected.issubset(set(Base.metadata.tables)), (
        expected - set(Base.metadata.tables)
    )


def test_celery_entrypoint_registers_domain_tasks():
    """`-A app.workers.tasks.celery_app` (docker-compose) регистрирует задачи доменов."""
    from app.workers.tasks import celery_app
    registered = set(celery_app.tasks)
    assert {"tasks.parse_excel", "tasks.generate_ai_summary", "tasks.cache_invalidate"} <= registered
