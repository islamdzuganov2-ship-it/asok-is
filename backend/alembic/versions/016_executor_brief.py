"""ТЗ v19 Фаза 4 — карточка меры на язык исполнителя, для внутреннего Ганта (п.16, УК-16)

Revision ID: 016
Revises: 015
Create Date: 2026-08-16

Аддитивно: новый nullable Text-столбец на proposals — переписанный LLM (персона EXECUTOR,
personas.py) текст меры для исполнителя (конкретные шаги/срок и риск/чем подтвердить), отдельно
от rationale (профсуждение менеджера по качеству) и expectation (что ожидается от ЛПР, п.14).
Задаёт менеджер по качеству кнопкой «Переписать для исполнителя» на карточке меры/плане задач —
executor_brief_generated_by/_at фиксируют, кто и когда запустил переписывание (не то же самое,
что owner/effort_hours_set_by — это разные операции над мерой).
"""
from alembic import op
import sqlalchemy as sa

revision = "016"
down_revision = "015"
branch_labels = None
depends_on = None


def _cols(table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    existing = _cols("proposals")
    with op.batch_alter_table("proposals") as batch:
        if "executor_brief" not in existing:
            batch.add_column(sa.Column("executor_brief", sa.Text(), nullable=True))
        if "executor_brief_generated_by" not in existing:
            batch.add_column(sa.Column("executor_brief_generated_by", sa.UUID(), nullable=True))
            batch.create_foreign_key(
                "fk_proposals_executor_brief_generated_by", "users",
                ["executor_brief_generated_by"], ["id"],
            )
        if "executor_brief_generated_at" not in existing:
            batch.add_column(sa.Column("executor_brief_generated_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    pr = _cols("proposals")
    with op.batch_alter_table("proposals") as batch:
        if "executor_brief_generated_at" in pr:
            batch.drop_column("executor_brief_generated_at")
        if "executor_brief_generated_by" in pr:
            batch.drop_constraint("fk_proposals_executor_brief_generated_by", type_="foreignkey")
            batch.drop_column("executor_brief_generated_by")
        if "executor_brief" in pr:
            batch.drop_column("executor_brief")
