"""Add unmeasurable flag to assessment_values

«Невозможно измерить» (нет возможности собрать данные): при True расчёт X не делается,
quality_level = «Невозможно измерить», expert_comment обязателен (валидируется на API).

Revision ID: 004
Revises: 003
Create Date: 2026-06-30 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = "004"
down_revision = "003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "assessment_values",
        sa.Column("unmeasurable", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )


def downgrade() -> None:
    op.drop_column("assessment_values", "unmeasurable")
