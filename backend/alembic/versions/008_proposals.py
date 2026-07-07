"""Add governance proposals (мера качества) — T-10

Переносит governance-петлю (меры/решения/эскалации/контроль) из фронтового localStorage в БД.
NB: в рабочем стеке схема создаётся через create_all на старте (app/main.py); эта миграция —
для консистентности alembic-истории и autogenerate.

Revision ID: 008
Revises: 007
Create Date: 2026-07-07 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "008"
down_revision = "007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "proposals",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("system_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("system_name", sa.String(255), nullable=False),
        sa.Column("characteristic", sa.String(255), nullable=True),
        sa.Column("metric_name", sa.String(255), nullable=True),
        sa.Column("calculated_score", sa.Float(), nullable=True),
        sa.Column("calculated_level", sa.String(64), nullable=True),
        sa.Column("adjusted_level", sa.String(64), nullable=True),
        sa.Column("rationale", sa.Text(), nullable=True),
        sa.Column("expectation", sa.Text(), nullable=True),
        sa.Column("create_risk", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("risk_title", sa.String(255), nullable=True),
        sa.Column("owner", sa.String(255), nullable=True),
        sa.Column("owner_role", sa.String(255), nullable=True),
        sa.Column("due_date", sa.String(32), nullable=True),
        sa.Column("status", sa.String(32), nullable=False, server_default="PENDING_APPROVAL"),
        sa.Column("decided_by", sa.String(255), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("decision_comment", sa.Text(), nullable=True),
        sa.Column("execution", sa.String(16), nullable=True),
        sa.Column("execution_comment", sa.Text(), nullable=True),
        sa.Column("executed_by", sa.String(255), nullable=True),
        sa.Column("executed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("suz_link", sa.String(512), nullable=True),
        sa.Column("top_comment", sa.Text(), nullable=True),
        sa.Column("escalated", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("escalation_reason", sa.Text(), nullable=True),
        sa.Column("escalation_decision", sa.String(32), nullable=True),
        sa.Column("escalation_decision_comment", sa.Text(), nullable=True),
        sa.Column("escalation_decided_by", sa.String(255), nullable=True),
        sa.Column("history", postgresql.JSONB(), nullable=True),
        sa.Column("is_demo", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_by", sa.String(255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_proposals_status", "proposals", ["status"])
    op.create_index("ix_proposals_system_name", "proposals", ["system_name"])


def downgrade() -> None:
    op.drop_table("proposals")
