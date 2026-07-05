"""BL-001 E1: контур оценки СИИ по ГОСТ Р 59898-2021

- systems.system_kind (CLASSIC | AI) — маршрутизация на модель качества;
- ai_assessment_values — значения метрик СИИ (ML-входы, baseline ± допуски,
  нормировка X, вердикт соответствия). Периоды переиспользуются.

Revision ID: 006
Revises: 005
Create Date: 2026-07-05 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "006"
down_revision = "005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "systems",
        sa.Column("system_kind", sa.String(10), nullable=False, server_default="CLASSIC"),
    )
    op.create_table(
        "ai_assessment_values",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("period_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("assessment_periods.id"), nullable=False),
        sa.Column("group_name", sa.String(100), nullable=False),
        sa.Column("characteristic", sa.String(255), nullable=False),
        sa.Column("subcharacteristic", sa.String(255), nullable=False),
        sa.Column("metric_kind", sa.String(20), nullable=False),
        sa.Column("inputs", postgresql.JSONB(), nullable=True),
        sa.Column("baseline", sa.Numeric(12, 4), nullable=True),
        sa.Column("tol_low", sa.Numeric(12, 4), nullable=True),
        sa.Column("tol_high", sa.Numeric(12, 4), nullable=True),
        sa.Column("raw_value", sa.Numeric(6, 4), nullable=True),
        sa.Column("normalized_x", sa.Numeric(6, 4), nullable=True),
        sa.Column("conformant", sa.Boolean(), nullable=True),
        sa.Column("unmeasurable", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("expert_comment", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("period_id", "characteristic", "subcharacteristic", name="uq_ai_value_period_pair"),
    )
    op.create_index("ix_ai_assessment_values_period_id", "ai_assessment_values", ["period_id"])


def downgrade() -> None:
    op.drop_index("ix_ai_assessment_values_period_id", table_name="ai_assessment_values")
    op.drop_table("ai_assessment_values")
    op.drop_column("systems", "system_kind")
