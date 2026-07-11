"""Add tech incidents (аналитика техсбоев) — T-21

Реестр технических сбоев ИС по первопричинам (релиз/инфраструктура/производительность/сеть/
электроснабжение). NB: схема в рабочем стеке создаётся через create_all на старте; миграция —
для консистентности alembic-истории.

Revision ID: 009
Revises: 008
Create Date: 2026-07-08 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "009"
down_revision = "008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "tech_incidents",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("system_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("system_name", sa.String(255), nullable=False),
        sa.Column("category", sa.String(32), nullable=False),
        sa.Column("severity", sa.String(16), nullable=False, server_default="medium"),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("root_cause", sa.Text(), nullable=True),
        sa.Column("release_ref", sa.String(255), nullable=True),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("source", sa.String(16), nullable=False, server_default="manual"),
        sa.Column("created_by", sa.String(255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_tech_incidents_system_name", "tech_incidents", ["system_name"])
    op.create_index("ix_tech_incidents_category", "tech_incidents", ["category"])
    op.create_index("ix_tech_incidents_occurred_at", "tech_incidents", ["occurred_at"])


def downgrade() -> None:
    op.drop_table("tech_incidents")
