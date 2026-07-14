"""Add incident mandatory fields + measure link (T-36/T-37/T-42)

Обязательные (для ручного ввода) поля разбора техсбоя: причина допущения, виновное направление,
меры по неповторению; пользовательская первопричина (category=OTHER); связь с мерой по улучшению
качества. NB: в рабочем стеке схема создаётся через create_all на старте; миграция — для
консистентности alembic-истории (в проде — реальное изменение схемы).

Revision ID: 010
Revises: 009
Create Date: 2026-07-11 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "010"
down_revision = "009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tech_incidents", sa.Column("admission_cause", sa.Text(), nullable=True))
    op.add_column("tech_incidents", sa.Column("responsible_unit", sa.String(255), nullable=True))
    op.add_column("tech_incidents", sa.Column("preventive_measures", sa.Text(), nullable=True))
    op.add_column("tech_incidents", sa.Column("category_custom", sa.String(255), nullable=True))
    op.add_column("tech_incidents", sa.Column("linked_measure_id", postgresql.UUID(as_uuid=True), nullable=True))


def downgrade() -> None:
    for col in ("linked_measure_id", "category_custom", "preventive_measures", "responsible_unit", "admission_cause"):
        op.drop_column("tech_incidents", col)
