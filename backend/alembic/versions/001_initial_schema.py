from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "001_initial"
down_revision = None

def upgrade() -> None:
    op.create_table("systems",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("code", sa.String(50), unique=True, nullable=True),
        sa.Column("status_lc", sa.String(50), nullable=False),
        sa.Column("criticality_class", sa.String(50), nullable=False),
        sa.Column("owner", sa.String(255), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default="true"),
        sa.Column("is_deleted", sa.Boolean(), server_default="false"),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("idx_systems_active", "systems", ["is_active", "is_deleted"])

    op.create_table("metric_catalog",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("characteristic", sa.String(100), nullable=False),
        sa.Column("subcharacteristic", sa.String(100), nullable=False),
        sa.Column("formula_type", sa.String(20), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("data_source_hint", sa.String(100), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default="true"),
    )

    op.create_table("users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("username", sa.String(100), unique=True, nullable=False),
        sa.Column("email", sa.String(255), unique=True, nullable=True),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("full_name", sa.String(255), nullable=True),
        sa.Column("role", sa.String(50), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default="true"),
        sa.Column("is_deleted", sa.Boolean(), server_default="false"),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_login", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table("assessment_periods",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("system_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("systems.id"), nullable=False),
        sa.Column("period", sa.String(20), nullable=False),
        sa.Column("status", sa.String(20), server_default="DRAFT"),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("idx_periods_system_period", "assessment_periods", ["system_id", "period"], unique=True)

    op.create_table("assessment_values",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("period_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("assessment_periods.id"), nullable=False),
        sa.Column("metric_id", sa.Integer(), sa.ForeignKey("metric_catalog.id"), nullable=False),
        sa.Column("val_a", sa.Numeric(10, 2), nullable=True),
        sa.Column("val_b", sa.Numeric(10, 2), nullable=True),
        sa.Column("calculated_x", sa.Numeric(4, 2), nullable=True),
        sa.Column("quality_level", sa.String(50), nullable=True),
        sa.Column("expert_comment", sa.Text(), nullable=True),
        sa.Column("artifact_links", postgresql.JSONB(), nullable=True),
        sa.Column("data_source", sa.String(20), server_default="MANUAL"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("idx_values_period", "assessment_values", ["period_id"])

    op.create_table("expert_judgments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("assessment_value_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("assessment_values.id"), nullable=False),
        sa.Column("original_level", sa.String(50), nullable=True),
        sa.Column("adjusted_level", sa.String(50), nullable=False),
        sa.Column("justification_text", sa.Text(), nullable=False),
        sa.Column("linked_risk_task", sa.String(500), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table("audit_log",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("action", sa.String(50), nullable=True),
        sa.Column("entity_type", sa.String(50), nullable=True),
        sa.Column("entity_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("old_values", postgresql.JSONB(), nullable=True),
        sa.Column("new_values", postgresql.JSONB(), nullable=True),
        sa.Column("ip_address", postgresql.INET(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("idx_audit_entity", "audit_log", ["entity_type", "entity_id"])

def downgrade() -> None:
    for t in ["audit_log", "expert_judgments", "assessment_values", "assessment_periods", "users", "metric_catalog", "systems"]:
        op.drop_table(t)