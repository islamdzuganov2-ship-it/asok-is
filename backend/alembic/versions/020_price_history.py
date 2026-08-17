"""ТЗ v19 §17.4 (УК-49/51) — дневная история Ц_ОМ для честной квартальной агрегации

Revision ID: 020
Revises: 019
Create Date: 2026-08-17

Отдельная таблица proposal_price_snapshots — одна строка на (мера, календарный день).
Переключатель «день/квартал» на карточке раньше показывал только два статичных числа
(снимок на просрочку + текущее); с этой таблицей «квартал» — честное среднее по реальным
дневным точкам за период, не переиспользование того же числа под другой подписью.
"""
from alembic import op
import sqlalchemy as sa

revision = "020"
down_revision = "019"
branch_labels = None
depends_on = None


def _tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def upgrade() -> None:
    if "proposal_price_snapshots" in _tables():
        return
    op.create_table(
        "proposal_price_snapshots",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("proposal_id", sa.UUID(), sa.ForeignKey("proposals.id", ondelete="CASCADE"), nullable=False),
        sa.Column("snapshot_date", sa.Date(), nullable=False),
        sa.Column("price", sa.Numeric(16, 2), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("proposal_id", "snapshot_date", name="uq_proposal_price_snapshot_day"),
    )
    op.create_index("ix_proposal_price_snapshots_proposal_id", "proposal_price_snapshots", ["proposal_id"])
    op.create_index("ix_proposal_price_snapshots_snapshot_date", "proposal_price_snapshots", ["snapshot_date"])


def downgrade() -> None:
    if "proposal_price_snapshots" in _tables():
        op.drop_table("proposal_price_snapshots")
