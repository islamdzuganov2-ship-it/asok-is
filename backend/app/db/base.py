"""
Регистрация всех ORM моделей для Alembic metadata.
Все модели должны быть импортированы здесь, иначе alembic их не увидит.
"""
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


# Импортируем все модели чтобы они попали в Base.metadata
# (нужно для alembic autogenerate и create_all)
from app.models.user import User                          # noqa: F401, E402
from app.models.system import System                      # noqa: F401, E402
from app.models.metric_catalog import MetricCatalog       # noqa: F401, E402
from app.models.assessment import AssessmentPeriod, AssessmentValue, ExpertJudgmentHistory  # noqa: F401, E402

__all__ = [
    "Base",
    "User",
    "System",
    "MetricCatalog",
    "AssessmentPeriod",
    "AssessmentValue",
    "ExpertJudgmentHistory"
]
