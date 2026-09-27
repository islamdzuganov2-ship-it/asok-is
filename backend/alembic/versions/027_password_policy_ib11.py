"""ИБ-11 — парольная политика: обязательная смена временного пароля и история паролей

Revision ID: 027
Revises: 026
Create Date: 2026-09-27

Аддитивно. must_change_password — пароль задан администратором и должен быть сменён при
первом входе; password_changed_at — момент последней смены; password_history — bcrypt-хэши
последних паролей (не повторять 5 последних). Существующие пользователи получают
must_change_password=false: их пароли политика не трогает, она действует при задании нового.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "027"
down_revision = "026"
branch_labels = None
depends_on = None


_COLUMNS = (
    ("must_change_password", sa.Boolean(), False, sa.text("false")),
    ("password_changed_at", sa.DateTime(timezone=True), True, None),
    ("password_history", JSONB(), False, sa.text("'[]'::jsonb")),
)


def _cols() -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns("users")}


def upgrade() -> None:
    # Идемпотентно, как 025: база, созданная create_all, уже может иметь эти колонки.
    existing = _cols()
    for name, type_, nullable, default in _COLUMNS:
        if name not in existing:
            op.add_column("users", sa.Column(name, type_, nullable=nullable, server_default=default))


def downgrade() -> None:
    existing = _cols()
    for name, *_ in reversed(_COLUMNS):
        if name in existing:
            op.drop_column("users", name)
