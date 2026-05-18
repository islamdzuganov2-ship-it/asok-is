```python
"""
Централизованная конфигурация приложения через Pydantic v2 BaseSettings.
Читает переменные из .env файла. Все секреты — только через env, никогда в git.
Соответствует ТЗ п.4 (NFR: Эксплуатация & DevOps, Безопасность).
"""
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
    )

    # --- База данных ---
    DATABASE_URL: str = Field(..., description="Async PostgreSQL DSN (asyncpg driver)")

    # --- Redis ---
    REDIS_URL: str = Field(default="redis://localhost:6379/0")

    # --- JWT ---
    JWT_SECRET: str = Field(..., description="HS256 signing key — обязателен в prod")
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # --- Ollama AI ---
    OLLAMA_API_URL: str = "http://ollama:11434/api/generate"
    OLLAMA_MODEL: str = "llama3:8b"

    # --- Feature Flags ---
    FEATURE_LDAP_AUTH: bool = False
    FEATURE_JIRA_INTEGRATION: bool = False
    FEATURE_MONITORING_INTEGRATION: bool = False
    FEATURE_AI_SUMMARY: bool = True
    FEATURE_LOG_EXPORT: bool = False
    FEATURE_PDF_REPORTS: bool = False
    DEMO_MODE: bool = True

    # --- Приложение ---
    LOG_LEVEL: str = "INFO"
    CORS_ORIGINS: list[str] = ["http://localhost:3000"]
    RATE_LIMIT_PER_MINUTE: int = 100


settings = Settings()
```
