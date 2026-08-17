"""ТЗ v19 УК-04/05/07 — редактор весов: u-уровень (характеристика→Q) + профили критичности

Revision ID: 022
Revises: 021
Create Date: 2026-08-17

Аддитивно, по образцу 019/020/021: новая колонка char_weights (u-уровень, JSONB,
{profile: {characteristic: u}}) рядом с уже существующей subchar_weights. Формат самой
subchar_weights МЕНЯЕТСЯ на прикладном уровне (был плоский список 31 строки на всю систему,
становится {profile: [[char, sub, w_within_char], ...]} на 3 профиля критичности) — колонка
уже JSONB без схемы, миграция БД для этого не нужна, перекодирование делает
weight_versions.ensure_active_version() при первом запуске после деплоя (старая активная
версия просто перестаёт совпадать с новым current_weight_snapshot() и переиздаётся).
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "022"
down_revision = "021"
branch_labels = None
depends_on = None


def _cols(table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    existing = _cols("weight_set_versions")
    with op.batch_alter_table("weight_set_versions") as batch:
        if "char_weights" not in existing:
            batch.add_column(sa.Column("char_weights", postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    existing = _cols("weight_set_versions")
    with op.batch_alter_table("weight_set_versions") as batch:
        if "char_weights" in existing:
            batch.drop_column("char_weights")
