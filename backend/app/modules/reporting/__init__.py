"""
Домен reporting — управленческие дашборды, Excel-матрицы периода, LLM-аналитика по мерам.

Публичный фасад (ТЗ v13). Роутер монтируется композиционным корнем из app.modules.reporting.router.
"""
from app.modules.reporting.models import DefectMatrix, QualityPlanMatrix, RiskMatrix
from app.modules.reporting.schemas import (
    DashboardDataOut,
    DefectMatrixRow,
    FullExcelMatricesOut,
    ProblematicSystemOut,
    QualityPlanMatrixRow,
    RiskMatrixRow,
)

__all__ = [
    "RiskMatrix",
    "DefectMatrix",
    "QualityPlanMatrix",
    "RiskMatrixRow",
    "DefectMatrixRow",
    "QualityPlanMatrixRow",
    "FullExcelMatricesOut",
    "ProblematicSystemOut",
    "DashboardDataOut",
]
