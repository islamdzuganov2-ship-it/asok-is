"""Пять таблиц, которых не было в миграциях (ДЕФ-03)

Revision ID: 013
Revises: 012
Create Date: 2026-08-15

Пока схема создавалась вызовом `Base.metadata.create_all()` (только под DEMO_MODE),
миграции жили своей жизнью и отстали от моделей. Как только `alembic upgrade head` начал
выполняться при старте (ДЕФ-03 / БТ-507), это стало видно: на чистой БД миграции давали
25 таблиц против 30 в моделях.

Не хватало:
  · role_permissions   — матрица RBAC (BL-008). Без неё резолвер прав падает, то есть
    продуктивная установка с нуля не работала бы вообще;
  · audit_log          — журнал аудита (T-19);
  · user_preferences   — персональные настройки (тема, шрифт, состав дашбордов);
  · metric_attributes, metric_characteristics — справочники каталога метрик.

Автогенерация предлагала вдобавок косметику: замену уникальных ограничений на уникальные
индексы, индексы по первичным ключам, ужесточение NOT NULL. В миграцию это НЕ включено —
на действующем стенде такие DDL переписывали бы индексы без функционального выигрыша.
Расхождение зафиксировано отдельно и правится осознанно (см. docs/stabilization).
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "013"
down_revision = "012"
branch_labels = None
depends_on = None


def _existing() -> set[str]:
    """Таблицы, уже присутствующие в БД.

    Миграция обязана быть идемпотентной по таблицам: на действующем стенде схема пришла из
    прежнего `create_all` и была принята штампом (stamp head на 012), поэтому все пять
    таблиц там УЖЕ есть — обычный CREATE TABLE упал бы на «relation already exists».
    На чистой БД (продуктив, CI) их нет и они создаются.
    """
    return set(sa.inspect(op.get_bind()).get_table_names())


def upgrade() -> None:
    existing = _existing()

    if "role_permissions" not in existing:
        _create_role_permissions()
    if "audit_log" not in existing:
        _create_audit_log()
    if "user_preferences" not in existing:
        _create_user_preferences()
    if "metric_attributes" not in existing:
        _create_metric_attributes()
    if "metric_characteristics" not in existing:
        _create_metric_characteristics()


def _create_role_permissions() -> None:
    op.create_table(
        "role_permissions",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("role", sa.String(length=50), nullable=False),
        sa.Column("permission", sa.String(length=100), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True),
                  server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("role", "permission", name="uq_role_permission"),
    )
    op.create_index("ix_role_permissions_role", "role_permissions", ["role"], unique=False)


def _create_audit_log() -> None:
    op.create_table(
        "audit_log",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=True),
        sa.Column("action", sa.String(length=50), nullable=True),
        sa.Column("entity_type", sa.String(length=50), nullable=True),
        sa.Column("entity_id", sa.UUID(), nullable=True),
        sa.Column("old_values", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("new_values", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("ip_address", postgresql.INET(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )


def _create_user_preferences() -> None:
    op.create_table(
        "user_preferences",
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("prefs", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True),
                  server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("user_id"),
    )


def _create_metric_attributes() -> None:
    op.create_table(
        "metric_attributes",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )


def _create_metric_characteristics() -> None:
    op.create_table(
        "metric_characteristics",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    existing = _existing()
    for table in ("metric_characteristics", "metric_attributes", "user_preferences", "audit_log"):
        if table in existing:
            op.drop_table(table)
    if "role_permissions" in existing:
        op.drop_index("ix_role_permissions_role", table_name="role_permissions")
        op.drop_table("role_permissions")
