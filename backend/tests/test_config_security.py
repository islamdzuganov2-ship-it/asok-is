"""Юнит-тесты контроля безопасности конфигурации (дефолтные секреты)."""
from app.infrastructure.config import Settings


def test_flags_insecure_defaults():
    s = Settings(
        JWT_SECRET_KEY="dev_secret_key_change_in_production_minimum_32_chars",
        DATABASE_URL="postgresql+asyncpg://asok_user:asok_pass123@postgres:5432/asok_is",
    )
    issues = s.security_issues()
    assert any("JWT_SECRET_KEY" in i for i in issues)
    assert any("DATABASE_URL" in i for i in issues)


def test_flags_short_secret():
    s = Settings(JWT_SECRET_KEY="short", DATABASE_URL="postgresql+asyncpg://u:strongpass@h/db")
    assert any("32" in i for i in s.security_issues())


def test_clean_config_has_no_issues():
    s = Settings(
        JWT_SECRET_KEY="a-sufficiently-long-random-production-secret-key-123456",
        DATABASE_URL="postgresql+asyncpg://u:Str0ng-Prod-Pass@db:5432/asok",
    )
    assert s.security_issues() == []
