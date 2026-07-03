"""Add professional_judgments table

Профессиональное суждение менеджера по качеству по подхарактеристике (НЕ мера).
По одному на пару (характеристика, подхарактеристика) в периоде.

Revision ID: 005
Revises: 004
Create Date: 2026-06-30 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "005"
down_revision = "004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "professional_judgments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("period_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("assessment_periods.id"), nullable=False),
        sa.Column("characteristic", sa.String(255), nullable=False),
        sa.Column("subcharacteristic", sa.String(255), nullable=False),
        sa.Column("judgment_text", sa.Text(), nullable=False),
        sa.Column("author", sa.String(255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("period_id", "characteristic", "subcharacteristic", name="uq_judgment_period_pair"),
    )
    op.create_index("ix_professional_judgments_period_id", "professional_judgments", ["period_id"])


def downgrade() -> None:
    op.drop_index("ix_professional_judgments_period_id", table_name="professional_judgments")
    op.drop_table("professional_judgments")
