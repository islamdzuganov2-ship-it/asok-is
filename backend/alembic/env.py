import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from logging.config import fileConfig
from sqlalchemy import engine_from_config, pool
from alembic import context
from app.core.config import settings # У вас должен быть файл настроек
connectable = create_engine(settings.DATABASE_URL.replace("asyncpg", "psycopg2"))

config = context.config

import os

def run_migrations_online():
    # Получаем URL из переменной окружения, которая задана в docker-compose.yml
    connectable = create_engine(
        os.getenv("DATABASE_URL").replace("asyncpg", "psycopg2"), # Alembic нужен синхронный драйвер
        poolclass=pool.NullPool,
    )

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# ЗДЕСЬ ИСПРАВЛЕННЫЙ ИМПОРТ
from app.core.database import Base
from app.models.system import System
from app.models.metric_catalog import MetricCatalog
from app.models.assessment import AssessmentPeriod, AssessmentValue, ExpertJudgmentHistory
from app.models.user import User 
from app.models.audit import AuditLog

target_metadata = Base.metadata
# Если есть модель User, импортируйте её здесь, иначе FK users.id может не сработать
# from app.models.user import User 


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