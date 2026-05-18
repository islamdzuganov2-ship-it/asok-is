import sys
import os
# Добавляем директорию backend/ в sys.path, чтобы работали импорты 'app.*'
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from logging.config import fileConfig
from sqlalchemy import engine_from_config, pool
from alembic import context

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Импортируем Base и модели, чтобы они были в target_metadata
from app.core.database import Base
from app.models.system import System
from app.models.metric_catalog import MetricCatalog
from app.models.assessment import AssessmentPeriod, AssessmentValue, ExpertJudgmentHistory

# Если есть модель User, импортируйте её здесь, иначе FK users.id может не сработать
# from app.models.user import User 

target_metadata = Base.metadata

def get_url():
    """Получение DATABASE_URL из env. 
    Alembic CLI синхронный, поэтому лучше использовать postgresql:// (psycopg2) в alembic.ini, 
    но этот код берет URL из конфига."""
    return config.get_main_option("sqlalchemy.url")

def run_migrations_offline() -> None:
    url = get_url()
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()

def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection, target_metadata=target_metadata
        )
        with context.begin_transaction():
            context.run_migrations()

if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()