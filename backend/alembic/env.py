# backend/alembic/env.py
from logging.config import fileConfig
from sqlalchemy import engine_from_config, pool, create_engine
from sqlalchemy.engine import Connection
from alembic import context
import os
import sys

# Добавляем путь к приложению для импортов
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Единый Base + реестр моделей (доменно-модульный монолит, ТЗ v13).
from app.infrastructure.database import Base, import_models

import_models()  # регистрирует модели всех модулей в Base.metadata (для autogenerate)

# Alembic Config object
config = context.config

# Настройка логирования
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Метаданные для авто-генерации миграций
target_metadata = Base.metadata

def get_url() -> str:
    """Получение DATABASE_URL из env, конвертация asyncpg → psycopg2 для Alembic"""
    url = os.getenv(
        "DATABASE_URL",
        "postgresql+asyncpg://asok_user:asok_pass123@postgres:5432/asok_is"
    )
    # Alembic работает с синхронным драйвером
    return url.replace("+asyncpg", "+psycopg2")

def run_migrations_offline() -> None:
    """Запуск миграций в offline-режиме (без подключения к БД)"""
    url = get_url()
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=True,  # Для совместимости с SQLite при тестировании
    )
    with context.begin_transaction():
        context.run_migrations()

def run_migrations_online() -> None:
    """Запуск миграций в online-режиме (с подключением к БД)"""
    configuration = config.get_section(config.config_ini_section) or {}
    configuration["sqlalchemy.url"] = get_url()
    
    connectable = engine_from_config(
        configuration,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            render_as_batch=True,
        )
        with context.begin_transaction():
            context.run_migrations()

if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()