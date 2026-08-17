"""ТЗ v19 §17.7 (УК-57) — факт по бюджету/трудоёмкости меры (перерасход)

Revision ID: 021
Revises: 020
Create Date: 2026-08-17

Аддитивно, по образцу 016/019: actual_capex/actual_opex/actual_effort_hours рядом с уже
существующим планом (capex/opex_per_year/effort_hours) — вносит исполнитель по завершении
меры (решение заказчика 7.1), отдельной фазой после Ц_ОМ (решение 7.2).
"""
from alembic import op
import sqlalchemy as sa

revision = "021"
down_revision = "020"
branch_labels = None
depends_on = None


def _cols(table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    existing = _cols("proposals")
    with op.batch_alter_table("proposals") as batch:
        if "actual_capex" not in existing:
            batch.add_column(sa.Column("actual_capex", sa.Numeric(16, 2), nullable=True))
        if "actual_opex" not in existing:
            batch.add_column(sa.Column("actual_opex", sa.Numeric(16, 2), nullable=True))
        if "actual_effort_hours" not in existing:
            batch.add_column(sa.Column("actual_effort_hours", sa.Numeric(8, 2), nullable=True))
        if "actuals_set_by" not in existing:
            batch.add_column(sa.Column("actuals_set_by", sa.UUID(), nullable=True))
            batch.create_foreign_key(
                "fk_proposals_actuals_set_by", "users", ["actuals_set_by"], ["id"],
            )
        if "actuals_set_at" not in existing:
            batch.add_column(sa.Column("actuals_set_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    pr = _cols("proposals")
    with op.batch_alter_table("proposals") as batch:
        if "actuals_set_at" in pr:
            batch.drop_column("actuals_set_at")
        if "actuals_set_by" in pr:
            batch.drop_constraint("fk_proposals_actuals_set_by", type_="foreignkey")
            batch.drop_column("actuals_set_by")
        if "actual_effort_hours" in pr:
            batch.drop_column("actual_effort_hours")
        if "actual_opex" in pr:
            batch.drop_column("actual_opex")
        if "actual_capex" in pr:
            batch.drop_column("actual_capex")
