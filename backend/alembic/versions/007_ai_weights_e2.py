"""BL-001 E2: веса свёртки СИИ (формулы 3–8) + широкие raw-значения метрик

- ai_weights: весовые коэффициенты на период (scope CHARACTERISTIC / SUB:<хар.>, Σ=1 на scope);
- ai_assessment_values.raw_value → Numeric(12,4): MSE/MAE/PSNR выходят за [0,1].

Revision ID: 007
Revises: 006
Create Date: 2026-07-05 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "007"
down_revision = "006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ai_weights",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("period_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("assessment_periods.id"), nullable=False),
        sa.Column("scope", sa.String(280), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("weight", sa.Numeric(6, 4), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("period_id", "scope", "name", name="uq_ai_weight_scope_name"),
    )
    op.create_index("ix_ai_weights_period_id", "ai_weights", ["period_id"])
    op.alter_column("ai_assessment_values", "raw_value", type_=sa.Numeric(12, 4))


def downgrade() -> None:
    op.alter_column("ai_assessment_values", "raw_value", type_=sa.Numeric(6, 4))
    op.drop_index("ix_ai_weights_period_id", table_name="ai_weights")
    op.drop_table("ai_weights")
