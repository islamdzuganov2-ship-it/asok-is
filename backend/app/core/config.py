from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    PROJECT_NAME: str = "АСОК ИС"
    DATABASE_URL: str = "postgresql+asyncpg://asok_user:asok_pass123@postgres:5432/asok_is"
    JWT_SECRET_KEY: str = "dev_secret_key_change_in_production_minimum_32_chars"
    DEMO_MODE: bool = True

    class Config:
        env_file = ".env"

settings = Settings()