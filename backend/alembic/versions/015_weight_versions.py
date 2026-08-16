"""ТЗ v19 Фаза 1 — версии весов и снапшоты истории (УК-05, УК-06)

Revision ID: 015
Revises: 014
Create Date: 2026-08-15

Две новые таблицы, полностью аддитивно — ни одна существующая таблица не меняется:
  · weight_set_versions   — самодостаточный снимок весового вектора (JSONB), РОВНО одна
    активная строка в любой момент (инвариант держит сервис quality/weight_versions.py);
  · score_history_snapshots — балл ИС за период, зафиксированный под конкретной версией
    весов; пишется ТОЛЬКО явным «пересчитать историю» (Р-3), не на каждый показ дашборда.

Живой дашборд (/assessments/dashboard) эти таблицы не читает и не пишет на обычный GET —
только явный recompute-эндпоинт. Поэтому миграция не требует бэкафилла: до первого вызова
recompute обе таблицы пусты, и это ожидаемое, безопасное состояние.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "015"
down_revision = "014"
branch_labels = None
depends_on = None


def _tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def upgrade() -> None:
    existing = _tables()

    if "weight_set_versions" not in existing:
        op.create_table(
            "weight_set_versions",
            sa.Column("id", sa.UUID(), nullable=False),
            sa.Column("label", sa.String(length=255), nullable=False),
            sa.Column("subchar_weights", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
            sa.Column("criticality_weights", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
            sa.Column("is_active", sa.Boolean(), nullable=False),
            sa.Column("created_by", sa.UUID(), nullable=True),
            sa.Column("note", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        )
        op.create_index("ix_weight_set_versions_is_active", "weight_set_versions", ["is_active"])

    if "score_history_snapshots" not in existing:
        op.create_table(
            "score_history_snapshots",
            sa.Column("id", sa.UUID(), nullable=False),
            sa.Column("weight_version_id", sa.UUID(), nullable=False),
            sa.Column("period_id", sa.UUID(), nullable=False),
            sa.Column("system_id", sa.UUID(), nullable=False),
            sa.Column("system_name", sa.String(length=255), nullable=False),
            sa.Column("score", sa.Numeric(6, 2), nullable=True),
            sa.Column("coverage", sa.Numeric(5, 4), nullable=False),
            sa.Column("breakdown", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
            sa.Column("computed_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            sa.ForeignKeyConstraint(["weight_version_id"], ["weight_set_versions.id"]),
            sa.ForeignKeyConstraint(["period_id"], ["assessment_periods.id"]),
            sa.ForeignKeyConstraint(["system_id"], ["systems.id"]),
        )
        op.create_index("ix_score_history_snapshots_weight_version_id", "score_history_snapshots", ["weight_version_id"])
        op.create_index("ix_score_history_snapshots_period_id", "score_history_snapshots", ["period_id"])
        op.create_index("ix_score_history_snapshots_system_id", "score_history_snapshots", ["system_id"])


def downgrade() -> None:
    existing = _tables()
    if "score_history_snapshots" in existing:
        op.drop_table("score_history_snapshots")
    if "weight_set_versions" in existing:
        op.drop_index("ix_weight_set_versions_is_active", table_name="weight_set_versions")
        op.drop_table("weight_set_versions")
