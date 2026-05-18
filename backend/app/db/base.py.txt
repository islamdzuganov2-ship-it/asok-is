# backend/app/db/base.py
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy import Column, DateTime, func

# Создаём базовый класс
Base = declarative_base()

class TimestampMixin:
    """Автоматические created_at / updated_at"""
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)

# === ВАЖНО: Импортируем все модели здесь, чтобы они зарегистрировались в Base.metadata ===
# Это необходимо для корректного создания таблиц с внешними ключами
from app.models.system import System, LifecycleStatus, CriticalityClass
from app.models.metric_catalog import MetricCatalog, FormulaType
from app.models.assessment import AssessmentPeriod, AssessmentValue, ExpertJudgmentHistory
# from app.models.user import User  # Раскомментируйте, когда создадите модель User

# Экспортируем Base для использования в других модулях
__all__ = ["Base", "TimestampMixin"]