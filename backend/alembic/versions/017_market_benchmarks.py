"""ТЗ v19 Фаза 5 — структура рыночных бенчмарков БП и ставок, без числового наполнения (п.9-10)

Revision ID: 017
Revises: 016
Create Date: 2026-08-16

Одна новая таблица, полностью аддитивно. В-30а (какими открытыми источниками пользоваться для
рыночных цифр) заказчиком НЕ решён — миграция заводит ТОЛЬКО структуру, таблица остаётся пустой
до появления первой реальной записи через UI/API (source/observed_on там обязательны — см.
econ/models.py MarketBenchmark). Дашборды сравнения (compare_*) уже умеют честно показывать
«нет бенчмарка» для пустой таблицы — это ожидаемое, а не переходное состояние.
"""
from alembic import op
import sqlalchemy as sa

revision = "017"
down_revision = "016"
branch_labels = None
depends_on = None


def _tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def upgrade() -> None:
    if "market_benchmarks" in _tables():
        return
    op.create_table(
        "market_benchmarks",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("dimension", sa.String(length=64), nullable=False),
        sa.Column("company_size_class", sa.String(length=16), nullable=True),
        sa.Column("value", sa.Numeric(16, 2), nullable=False),
        sa.Column("unit", sa.String(length=32), nullable=False),
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column("observed_on", sa.Date(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_by", sa.UUID(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
    )
    op.create_index("ix_market_benchmarks_kind", "market_benchmarks", ["kind"])
    op.create_index("ix_market_benchmarks_dimension", "market_benchmarks", ["dimension"])


def downgrade() -> None:
    if "market_benchmarks" not in _tables():
        return
    op.drop_index("ix_market_benchmarks_dimension", table_name="market_benchmarks")
    op.drop_index("ix_market_benchmarks_kind", table_name="market_benchmarks")
    op.drop_table("market_benchmarks")
