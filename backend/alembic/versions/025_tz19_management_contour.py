"""ТЗ-19 — управленческий контур: журнал уведомлений (УК-15/17), типовые ставки (УК-25),
«В работу» из карточки меры (УК-38, УК-18)

Revision ID: 025
Revises: 024
Create Date: 2026-09-26

Аддитивно: новая таблица и nullable-колонки (или с server_default) — существующие строки не
трогаются, существующие ставки остаются «введены вручную» (source = MANUAL).

notification_deliveries — журнал отправок уведомлений: каждое событие, доставленное, упавшее
    или недоставляемое (нет email), с числом попыток и причиной (УК-15); вложения (.ics, УК-17).
support_rates: source, reference_benchmark_id, confirmed_at, confirmed_by — ставка из
    справочника типовых ставок и её подтверждение (УК-25).
market_benchmarks: line, industry, qualification — разрез типовой ставки (УК-25).
proposals: task_ref, taken_to_work_at — мера взята в работу, ссылка от TaskSyncPort (УК-38, УК-18).
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "025"
down_revision = "024"
branch_labels = None
depends_on = None

_UUID = postgresql.UUID(as_uuid=True)

_COLUMNS = {
    "support_rates": (
        ("source", sa.String(16), {"server_default": "MANUAL", "nullable": False}),
        ("reference_benchmark_id", _UUID, {}),
        ("confirmed_at", sa.DateTime(timezone=True), {}),
        ("confirmed_by", sa.String(255), {}),
    ),
    "market_benchmarks": (
        ("line", sa.String(4), {}),
        ("industry", sa.String(255), {}),
        ("qualification", sa.String(64), {}),
    ),
    "proposals": (
        ("task_ref", sa.String(255), {}),
        ("taken_to_work_at", sa.DateTime(timezone=True), {}),
    ),
}
_FK_NAME = "fk_support_rates_reference_benchmark"


def _cols(table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def _tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def upgrade() -> None:
    for table, columns in _COLUMNS.items():
        existing = _cols(table)
        for name, type_, extra in columns:
            if name not in existing:
                op.add_column(table, sa.Column(name, type_, nullable=extra.get("nullable", True),
                                               server_default=extra.get("server_default")))
    fks = {fk["name"] for fk in sa.inspect(op.get_bind()).get_foreign_keys("support_rates")}
    if _FK_NAME not in fks:
        op.create_foreign_key(_FK_NAME, "support_rates", "market_benchmarks",
                              ["reference_benchmark_id"], ["id"], ondelete="SET NULL")

    if "notification_deliveries" not in _tables():
        op.create_table(
            "notification_deliveries",
            sa.Column("id", _UUID, primary_key=True),
            sa.Column("event_type", sa.String(64), nullable=False),
            sa.Column("recipient", sa.String(255), nullable=False),
            sa.Column("address", sa.String(1024), nullable=True),
            sa.Column("channel", sa.String(32), nullable=False, server_default="email"),
            sa.Column("subject", sa.String(512), nullable=False),
            sa.Column("body", sa.Text(), nullable=False, server_default=""),
            sa.Column("entity_type", sa.String(32), nullable=False),
            sa.Column("entity_id", sa.String(64), nullable=False),
            sa.Column("attachments", postgresql.JSONB(), nullable=True),
            sa.Column("status", sa.String(16), nullable=False),
            sa.Column("reason", sa.Text(), nullable=True),
            sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("dedupe_key", sa.String(255), nullable=True),
            sa.Column("is_retryable", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("last_attempt_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        )
        for col in ("event_type", "entity_id", "status", "dedupe_key"):
            op.create_index(f"ix_notification_deliveries_{col}", "notification_deliveries", [col])


def downgrade() -> None:
    if "notification_deliveries" in _tables():
        op.drop_table("notification_deliveries")
    fks = {fk["name"] for fk in sa.inspect(op.get_bind()).get_foreign_keys("support_rates")}
    if _FK_NAME in fks:
        op.drop_constraint(_FK_NAME, "support_rates", type_="foreignkey")
    for table, columns in _COLUMNS.items():
        existing = _cols(table)
        for name, _, _ in columns:
            if name in existing:
                op.drop_column(table, name)
