# backend/alembic/versions/001_initial_schema.py
"""Initial schema: systems, metrics, assessments

Revision ID: 001
Revises: 
Create Date: 2026-05-18 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
import uuid

revision = '001'
down_revision = None
branch_labels = None
depends_on = None

def upgrade() -> None:
    # === users ===
    op.create_table(
        'users',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column('username', sa.String(100), nullable=False, unique=True),
        sa.Column('email', sa.String(255), nullable=True, unique=True),
        sa.Column('password_hash', sa.String(255), nullable=False),
        sa.Column('full_name', sa.String(255), nullable=True),
        sa.Column('role', sa.String(50), nullable=False),
        sa.Column('is_active', sa.Boolean, default=True, nullable=False),
        sa.Column('last_login', sa.DateTime(timezone=True), nullable=True),
        sa.Column('is_deleted', sa.Boolean, default=False, nullable=False),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )

    # === systems ===
    op.create_table(
        'systems',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column('name', sa.String(255), nullable=False, index=True),
        sa.Column('code', sa.String(50), unique=True, index=True),
        sa.Column('status_lc', sa.Enum('ОЭ', 'ПЭ', 'Создание и тестирование', name='lifecyclestatus'), nullable=False),
        sa.Column('criticality_class', sa.Enum('MISSION CRITICAL', 'BUSINESS CRITICAL', 'BUSINESS OPERATIONAL', name='criticalityclass'), nullable=False),
        sa.Column('owner', sa.String(255), nullable=True),
        sa.Column('is_active', sa.Boolean, default=True, nullable=False),
        sa.Column('is_deleted', sa.Boolean, default=False, nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )
    
    # === metric_catalog ===
    op.create_table(
        'metric_catalog',
        sa.Column('id', sa.Integer, primary_key=True, index=True),
        sa.Column('characteristic', sa.String(255), nullable=False, index=True),
        sa.Column('subcharacteristic', sa.String(255), nullable=False),
        sa.Column('formula_type', sa.Enum('DIRECT', 'INVERSE', name='formulatype'), nullable=False),
        sa.Column('description', sa.Text, nullable=True),
        sa.Column('data_source', sa.String(255), nullable=True),
        sa.Column('is_active', sa.Boolean, default=True, nullable=False),
    )
    
    # === assessment_periods ===
    op.create_table(
        'assessment_periods',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column('system_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('systems.id'), nullable=False, index=True),
        sa.Column('period', sa.String(20), nullable=False),
        sa.Column('status', sa.String(20), default='DRAFT'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
        sa.UniqueConstraint('system_id', 'period', name='uq_system_period'),
    )
    
    # === assessment_values ===
    op.create_table(
        'assessment_values',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column('period_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('assessment_periods.id'), nullable=False, index=True),
        sa.Column('metric_id', sa.Integer, sa.ForeignKey('metric_catalog.id'), nullable=False, index=True),
        sa.Column('val_a', sa.Numeric(10, 2), nullable=True),
        sa.Column('val_b', sa.Numeric(10, 2), nullable=True),
        sa.Column('calculated_x', sa.Numeric(4, 2), nullable=True),
        sa.Column('quality_level', sa.String(50), nullable=True),
        sa.Column('expert_comment', sa.Text, nullable=True),
        sa.Column('artifact_links', postgresql.JSONB, nullable=True),
        sa.Column('data_source', sa.String(20), default='MANUAL'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )
    
    # === expert_judgment_history ===
    op.create_table(
        'expert_judgment_history',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column('assessment_value_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('assessment_values.id'), nullable=False, index=True),
        sa.Column('original_level', sa.String(50), nullable=True),
        sa.Column('adjusted_level', sa.String(50), nullable=True),
        sa.Column('justification_text', sa.Text, nullable=False),
        sa.Column('linked_risk_task', sa.String(500), nullable=True),
        sa.Column('created_by', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

def downgrade() -> None:
    op.drop_table('expert_judgment_history')
    op.drop_table('assessment_values')
    op.drop_table('assessment_periods')
    op.drop_table('metric_catalog')
    op.drop_table('systems')
    op.drop_table('users')
    # Drop enums
    sa.Enum(name='lifecyclestatus').drop(op.get_bind(), checkfirst=True)
    sa.Enum(name='criticalityclass').drop(op.get_bind(), checkfirst=True)
    sa.Enum(name='formulatype').drop(op.get_bind(), checkfirst=True)
