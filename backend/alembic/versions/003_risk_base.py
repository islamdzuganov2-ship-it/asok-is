"""Add cumulative risk knowledge base (risk_base)

Revision ID: 003
Revises: 002
Create Date: 2026-06-26 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "003"
down_revision = "002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "risk_base",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("code", sa.String(), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("category", sa.String(), nullable=False),
        sa.Column("characteristic", sa.String(), nullable=True),
        sa.Column("subcharacteristic", sa.String(), nullable=True),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("consequence", sa.Text(), nullable=True),
        sa.Column("mitigation", sa.Text(), nullable=True),
        sa.Column("severity", sa.String(), nullable=False, server_default="medium"),
        sa.Column("likelihood", sa.String(), nullable=False, server_default="medium"),
        sa.Column("triggers", sa.Text(), nullable=True),
        sa.Column("keywords", sa.Text(), nullable=True),
        sa.Column("source", sa.String(), nullable=False, server_default="manual"),
        sa.Column("system_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("status", sa.String(), nullable=False, server_default="active"),
        sa.Column("created_by", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_unique_constraint("uq_risk_base_code", "risk_base", ["code"])
    op.create_index("ix_risk_base_code", "risk_base", ["code"])
    op.create_index("ix_risk_base_category", "risk_base", ["category"])
    op.create_index("ix_risk_base_characteristic", "risk_base", ["characteristic"])
    op.create_index("ix_risk_base_status", "risk_base", ["status"])


def downgrade() -> None:
    op.drop_table("risk_base")
