---
tags:
  - бэк
---

# АСОК ИС — Alembic Migration + Docker Compose
**Дата:** 2026-05-17 | **Итерация:** 1

## backend/alembic/versions/001_initial_schema.py

Создаёт таблицы: systems, metric_catalog, users, assessment_periods, assessment_values, expert_judgments, audit_log.

Индексы:
- idx_systems_active (is_active, is_deleted)
- idx_periods_system_period (system_id, period) UNIQUE
- idx_values_period (period_id)
- idx_audit_entity (entity_type, entity_id)

```python
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "001_initial"
down_revision = None

def upgrade() -> None:
    op.create_table("systems",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("code", sa.String(50), unique=True, nullable=True),
        sa.Column("status_lc", sa.String(50), nullable=False),
        sa.Column("criticality_class", sa.String(50), nullable=False),
        sa.Column("owner", sa.String(255), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default="true"),
        sa.Column("is_deleted", sa.Boolean(), server_default="false"),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("idx_systems_active", "systems", ["is_active", "is_deleted"])

    op.create_table("metric_catalog",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("characteristic", sa.String(100), nullable=False),
        sa.Column("subcharacteristic", sa.String(100), nullable=False),
        sa.Column("formula_type", sa.String(20), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("data_source_hint", sa.String(100), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default="true"),
    )

    op.create_table("users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("username", sa.String(100), unique=True, nullable=False),
        sa.Column("email", sa.String(255), unique=True, nullable=True),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("full_name", sa.String(255), nullable=True),
        sa.Column("role", sa.String(50), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default="true"),
        sa.Column("is_deleted", sa.Boolean(), server_default="false"),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_login", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table("assessment_periods",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("system_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("systems.id"), nullable=False),
        sa.Column("period", sa.String(20), nullable=False),
        sa.Column("status", sa.String(20), server_default="DRAFT"),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("idx_periods_system_period", "assessment_periods", ["system_id", "period"], unique=True)

    op.create_table("assessment_values",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("period_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("assessment_periods.id"), nullable=False),
        sa.Column("metric_id", sa.Integer(), sa.ForeignKey("metric_catalog.id"), nullable=False),
        sa.Column("val_a", sa.Numeric(10, 2), nullable=True),
        sa.Column("val_b", sa.Numeric(10, 2), nullable=True),
        sa.Column("calculated_x", sa.Numeric(4, 2), nullable=True),
        sa.Column("quality_level", sa.String(50), nullable=True),
        sa.Column("expert_comment", sa.Text(), nullable=True),
        sa.Column("artifact_links", postgresql.JSONB(), nullable=True),
        sa.Column("data_source", sa.String(20), server_default="MANUAL"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("idx_values_period", "assessment_values", ["period_id"])

    op.create_table("expert_judgments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("assessment_value_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("assessment_values.id"), nullable=False),
        sa.Column("original_level", sa.String(50), nullable=True),
        sa.Column("adjusted_level", sa.String(50), nullable=False),
        sa.Column("justification_text", sa.Text(), nullable=False),
        sa.Column("linked_risk_task", sa.String(500), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table("audit_log",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("action", sa.String(50), nullable=True),
        sa.Column("entity_type", sa.String(50), nullable=True),
        sa.Column("entity_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("old_values", postgresql.JSONB(), nullable=True),
        sa.Column("new_values", postgresql.JSONB(), nullable=True),
        sa.Column("ip_address", postgresql.INET(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("idx_audit_entity", "audit_log", ["entity_type", "entity_id"])

def downgrade() -> None:
    for t in ["audit_log", "expert_judgments", "assessment_values", "assessment_periods", "users", "metric_catalog", "systems"]:
        op.drop_table(t)
```

## docker-compose.yml
```yaml
version: "3.9"
services:
  postgres:
    image: postgres:14-alpine
    environment:
      POSTGRES_DB: asok_is
      POSTGRES_USER: ${POSTGRES_USER:-asok_user}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-asok_pass}
    volumes: [pgdata:/var/lib/postgresql/data]
    ports: ["5432:5432"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-asok_user} -d asok_is"]
      interval: 10s
      retries: 5

  redis:
    image: redis:7-alpine
    command: redis-server --save 60 1
    volumes: [redisdata:/data]
    ports: ["6379:6379"]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      retries: 5

  backend:
    build: { context: ./backend }
    env_file: .env
    environment:
      DATABASE_URL: postgresql://${POSTGRES_USER:-asok_user}:${POSTGRES_PASSWORD:-asok_pass}@postgres:5432/asok_is
      REDIS_URL: redis://redis:6379/0
    ports: ["8000:8000"]
    depends_on:
      postgres: { condition: service_healthy }
      redis: { condition: service_healthy }
    volumes: [./backend:/app, upload_data:/app/uploads]
    command: >
      sh -c "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload"

  celery_worker:
    build: { context: ./backend }
    env_file: .env
    environment:
      DATABASE_URL: postgresql://${POSTGRES_USER:-asok_user}:${POSTGRES_PASSWORD:-asok_pass}@postgres:5432/asok_is
      REDIS_URL: redis://redis:6379/0
    depends_on: [backend, redis]
    volumes: [./backend:/app, upload_data:/app/uploads]
    command: celery -A app.workers.tasks.celery_app worker --loglevel=info --concurrency=4

  frontend:
    build: { context: ./frontend }
    ports: ["3000:80"]
    depends_on: [backend]
    environment:
      REACT_APP_API_BASE_URL: http://backend:8000

  ollama:
    image: ollama/ollama:latest
    profiles: ["ai"]
    volumes: [ollamadata:/root/.ollama]
    ports: ["11434:11434"]

volumes:
  pgdata:
  redisdata:
  ollamadata:
  upload_data:
```

Запуск:
- `docker compose up` — без AI
- `docker compose --profile ai up` — с Ollama
