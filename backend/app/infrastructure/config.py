"""
Конфигурация приложения. Все значения берутся из .env / переменных окружения.

Каноническое место (ТЗ v13, infrastructure). Обратная совместимость: app.core.config
ре-экспортирует settings/Settings отсюда (shim), пока ссылки не переведены.
"""
from pydantic_settings import BaseSettings
from typing import List
from pydantic import ConfigDict
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

    # LLM (in-process, llama.cpp / GGUF — без внешних сервисов).
    # МОДЕЛЬ-АГНОСТИЧНО: система принимает ЛЮБУЮ GGUF-модель, положенную в LOCAL_LLM_MODEL_DIR,
    # опрашивает её метаданные (архитектура, окно контекста, шаблон чата) и адаптируется.
    # LOCAL_LLM_MODEL_FILE="auto" → автоподбор файла из папки (новейший *.gguf); можно задать
    # конкретное имя, чтобы закрепить модель. Рантайм llama-cpp-python>=0.3 грузит современные
    # архитектуры (qwen2/qwen3, llama, gemma2, phi3, mistral и др.).
    LLM_ENABLED: bool = True
    LOCAL_LLM_MODEL_DIR: str = "models/llm"
    LOCAL_LLM_MODEL_FILE: str = "auto"   # "auto" → автоподбор; либо явное имя файла .gguf
    LLM_N_CTX: int = 4096                 # верхняя граница; фактически ограничивается окном модели
    LLM_N_THREADS: int = 8               # потоки CPU (крупные модели — больше)
    LLM_N_GPU_LAYERS: int = 0            # 0 = CPU; -1 = все слои на GPU (нужна CUDA/Metal-сборка)
    LLM_MAX_TOKENS: int = 320
    LLM_TEMPERATURE: float = 0.1         # максимум детерминизма/честности
    LLM_TOP_P: float = 0.9
    LLM_CHAT_FORMAT: str = "auto"        # "auto" → шаблон чата из GGUF; иначе явный формат llama.cpp

    # «Резервный мозг»: обучение и настройки LLM хранятся ВНЕ файла модели (переносимо между
    # моделями) — writable-каталог, отдельный от read-only каталога моделей. См. modules/llm/brain.py.
    LLM_BRAIN_DIR: str = "models/llm_brain"

    @property
    def LLM_MODEL_PATH(self) -> str:
        """Явно сконфигурированный путь (для обратной совместимости). Фактически загружаемый файл
        определяет service.discover_model_path() с учётом режима "auto"."""
        name = self.LOCAL_LLM_MODEL_FILE if self.LOCAL_LLM_MODEL_FILE not in ("", "auto", "AUTO") else "asok-model.gguf"
        return os.path.join(self.LOCAL_LLM_MODEL_DIR, name)

    # Внешние интеграции (ТЗ v13 §B5): пустой URL = интеграция выключена (работает заглушка).
    # Реальные адаптеры (фаза 4+) читают эндпоинты/токены ТОЛЬКО отсюда (env), не из кода.
    KMS_API_URL: str = ""     # СУЗ (система управления знаниями)
    KMS_API_TOKEN: str = ""
    TMS_API_URL: str = ""     # ТМС (управление тестированием)
    TMS_API_TOKEN: str = ""
    ITSM_API_URL: str = ""    # ITSM (инциденты/проблемы/изменения)
    ITSM_API_TOKEN: str = ""
    DWH_URL: str = ""         # Хранилище данных (приём сырья + выгрузка анализа)
    DWH_TOKEN: str = ""

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
