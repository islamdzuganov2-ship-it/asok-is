"""ТЗ v20 п.10 — обязательные разделы, фиксируемые супер-администратором глобально

Revision ID: 018
Revises: 017
Create Date: 2026-08-16

Наличие строки (permission) = раздел обязателен для ВСЕХ пользователей (независимо от роли) и не
может быть скрыт в персональных настройках («Настройка» → состав и порядок разделов). Одна колонка,
без роли — этим отличается от role_permissions (BL-008): там факт «роль имеет право», здесь факт
«раздел нельзя выключить никому». Пустая таблица по умолчанию — ничего не обязательно, пока
супер-админ явно не зафиксирует.
"""
from alembic import op
import sqlalchemy as sa

revision = "018"
down_revision = "017"
branch_labels = None
depends_on = None


def _tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def upgrade() -> None:
    if "mandatory_sections" in _tables():
        return
    op.create_table(
        "mandatory_sections",
        sa.Column("permission", sa.String(length=100), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("permission"),
    )


def downgrade() -> None:
    if "mandatory_sections" not in _tables():
        return
    op.drop_table("mandatory_sections")
