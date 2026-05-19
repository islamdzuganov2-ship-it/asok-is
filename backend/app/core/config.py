"""
Конфигурация приложения. Все значения берутся из .env / переменных окружения.
"""
from pydantic_settings import BaseSettings
from typing import List
import os

class Settings(BaseSettings):
    # Основное
    PROJECT_NAME: str = "АСОК ИС"

    # База данных
    DATABASE_URL: str = "postgresql+asyncpg://asok_user:asok_pass123@postgres:5432/asok_is"

    # JWT
    JWT_SECRET_KEY: str = "dev_secret_key_change_in_production_minimum_32_chars"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # Redis / Celery
    REDIS_URL: str = "redis://redis:6379/0"

    # Ollama AI
    OLLAMA_API_URL: str = "http://ollama:11434"
    OLLAMA_MODEL: str = "asok-model:latest"

    # CORS
    CORS_ORIGINS: List[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000"
    ]

    # Режимы
    DEMO_MODE: bool = True

    # Загрузки
    UPLOAD_DIR: str = "uploads"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"

settings = Settings()