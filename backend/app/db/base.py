"""
Регистрация всех моделей SQLAlchemy для корректной работы create_all.
"""
from app.db.base_class import Base          # предполагаем, что Base определён там
from app.models.user import User
from app.models.system import System
from app.models.metric import MetricCatalog
from app.models.assessment import AssessmentPeriod, AssessmentValue
from app.models.expert_judgment import ExpertJudgmentHistory

__all__ = [
    "Base",
    "User",
    "System",
    "MetricCatalog",
    "AssessmentPeriod",
    "AssessmentValue",
    "ExpertJudgmentHistory"
]