"""
Конфигурация приложения. Все значения берутся из .env / переменных окружения.
"""
from pydantic_settings import BaseSettings
from typing import List
from pydantic import ConfigDict
from typing import List
import os

class Settings(BaseSettings):
    model_config = ConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",          # ← ключевое: игнорировать лишние переменные окружения
        case_sensitive=False,
    )

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

    # LLM (in-process, llama.cpp / GGUF — без внешних сервисов)
    # Модель: Qwen2.5-1.5B-Instruct Q4_K_M (arch `qwen2`), файл models/llm/asok-model.gguf.
    # NB: arch `qwen35` (Qwen3.5) текущим рантаймом не поддерживается — см. docs/LLM_SETUP.md.
    LLM_ENABLED: bool = True
    LOCAL_LLM_MODEL_DIR: str = "models/llm"
    LOCAL_LLM_MODEL_FILE: str = "asok-model.gguf"
    LLM_N_CTX: int = 4096
    LLM_N_THREADS: int = 8          # 9B на CPU — больше потоков
    LLM_N_GPU_LAYERS: int = 0       # >0 если собран llama.cpp с CUDA/Metal
    LLM_MAX_TOKENS: int = 320
    LLM_TEMPERATURE: float = 0.1    # максимум детерминизма/честности
    LLM_TOP_P: float = 0.9

    @property
    def LLM_MODEL_PATH(self) -> str:
        return os.path.join(self.LOCAL_LLM_MODEL_DIR, self.LOCAL_LLM_MODEL_FILE)

    # CORS
    CORS_ORIGINS: List[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]

    # Режимы
    DEMO_MODE: bool = True

    # Загрузки
    UPLOAD_DIR: str = "uploads"

    _INSECURE_JWT_DEFAULT = "dev_secret_key_change_in_production_minimum_32_chars"
    _INSECURE_DB_DEFAULTS = ("asok_pass123",)

    def security_issues(self) -> list[str]:
        """
        Перечень проблем безопасности конфигурации (для старта приложения).
        Учитывает требования к управлению секретами (ГОСТ Р 57580, 152-ФЗ).
        """
        issues: list[str] = []
        if self.JWT_SECRET_KEY == self._INSECURE_JWT_DEFAULT:
            issues.append("JWT_SECRET_KEY использует небезопасное значение по умолчанию")
        if len(self.JWT_SECRET_KEY) < 32:
            issues.append("JWT_SECRET_KEY короче 32 символов")
        if any(d in self.DATABASE_URL for d in self._INSECURE_DB_DEFAULTS):
            issues.append("DATABASE_URL содержит пароль по умолчанию")
        return issues


settings = Settings()
