"""Add Excel report matrices

Revision ID: 002
Revises: 001
Create Date: 2026-05-27 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "002"
down_revision = "001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "risk_matrices",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("period_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("assessment_periods.id", ondelete="CASCADE"), nullable=False),
        sa.Column("characteristic", sa.String(), nullable=False),
        sa.Column("subcharacteristic", sa.String(), nullable=False),
        sa.Column("risk_description", sa.String(), nullable=False),
        sa.Column("risk_consequence", sa.String(), nullable=False),
        sa.Column("mitigation_measures", sa.String(), nullable=False),
    )
    op.create_table(
        "defect_matrices",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("period_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("assessment_periods.id", ondelete="CASCADE"), nullable=False),
        sa.Column("characteristic", sa.String(), nullable=False),
        sa.Column("digital_metric", sa.String(), nullable=True),
        sa.Column("quality_metric_level", sa.String(), nullable=True),
        sa.Column("defect_description", sa.String(), nullable=False),
    )
    op.create_table(
        "quality_plan_matrices",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("period_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("assessment_periods.id", ondelete="CASCADE"), nullable=False),
        sa.Column("characteristic", sa.String(), nullable=False),
        sa.Column("subcharacteristic", sa.String(), nullable=False),
        sa.Column("task_description", sa.String(), nullable=False),
        sa.Column("internal_document", sa.String(), nullable=True),
        sa.Column("assignee_fio", sa.String(), nullable=True),
        sa.Column("assignee_role", sa.String(), nullable=True),
        sa.Column("assignee_department", sa.String(), nullable=True),
        sa.Column("deadline", sa.String(), nullable=False),
        sa.Column("profile_executor", sa.String(), nullable=True),
        sa.Column("tech_debt_link", sa.String(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("quality_plan_matrices")
    op.drop_table("defect_matrices")
    op.drop_table("risk_matrices")
