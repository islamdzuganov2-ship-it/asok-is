"""ТЗ v19 Пункт 17 — карточка поручения, критичность, Ц_ОМ

Revision ID: 019
Revises: 018
Create Date: 2026-08-17

Аддитивно, аналогично 016/018. На `proposals`: маршрутизация по критичности
(is_process_measure/is_blocking_override, §17.2), Ц_ОМ снимок+текущее (§17.4),
состав карточки эскалации (альтернативы/системность/направление, §17.3), источник
и ревью LLM-рекомендаций (§17.6). Новая таблица `measure_departments` — временный
справочник направлений (§17.3, УК-47), задел под интеграцию с AD.
"""
from alembic import op
import sqlalchemy as sa

revision = "019"
down_revision = "018"
branch_labels = None
depends_on = None


def _cols(table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def _tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def upgrade() -> None:
    existing = _cols("proposals")
    with op.batch_alter_table("proposals") as batch:
        if "is_process_measure" not in existing:
            batch.add_column(sa.Column(
                "is_process_measure", sa.Boolean(), nullable=False, server_default=sa.false(),
            ))
        if "is_blocking_override" not in existing:
            batch.add_column(sa.Column(
                "is_blocking_override", sa.Boolean(), nullable=False, server_default=sa.false(),
            ))
        if "ale_at_risk_snapshot" not in existing:
            batch.add_column(sa.Column("ale_at_risk_snapshot", sa.Numeric(16, 2), nullable=True))
        if "ale_at_risk_snapshot_at" not in existing:
            batch.add_column(sa.Column("ale_at_risk_snapshot_at", sa.DateTime(timezone=True), nullable=True))
        if "ale_at_risk_current" not in existing:
            batch.add_column(sa.Column("ale_at_risk_current", sa.Numeric(16, 2), nullable=True))
        if "ale_at_risk_current_at" not in existing:
            batch.add_column(sa.Column("ale_at_risk_current_at", sa.DateTime(timezone=True), nullable=True))
        if "alternative_solutions" not in existing:
            batch.add_column(sa.Column("alternative_solutions", sa.JSON(), nullable=True))
        if "systemic_scope_note" not in existing:
            batch.add_column(sa.Column("systemic_scope_note", sa.Text(), nullable=True))
        if "systemic_scope_llm_note" not in existing:
            batch.add_column(sa.Column("systemic_scope_llm_note", sa.Text(), nullable=True))
        if "systemic_scope_system_count" not in existing:
            batch.add_column(sa.Column("systemic_scope_system_count", sa.Integer(), nullable=True))
        if "department" not in existing:
            batch.add_column(sa.Column("department", sa.String(255), nullable=True))
        if "measure_source" not in existing:
            batch.add_column(sa.Column(
                "measure_source", sa.String(16), nullable=False, server_default="MANUAL",
            ))
        if "llm_reviewed_by" not in existing:
            batch.add_column(sa.Column("llm_reviewed_by", sa.UUID(), nullable=True))
            batch.create_foreign_key(
                "fk_proposals_llm_reviewed_by", "users", ["llm_reviewed_by"], ["id"],
            )
        if "llm_reviewed_at" not in existing:
            batch.add_column(sa.Column("llm_reviewed_at", sa.DateTime(timezone=True), nullable=True))

    nc_existing = _cols("nonconformities")
    with op.batch_alter_table("nonconformities") as batch:
        if "sla_escalated" not in nc_existing:
            batch.add_column(sa.Column(
                "sla_escalated", sa.Boolean(), nullable=False, server_default=sa.false(),
            ))
        if "sla_escalated_at" not in nc_existing:
            batch.add_column(sa.Column("sla_escalated_at", sa.DateTime(timezone=True), nullable=True))

    if "measure_departments" not in _tables():
        op.create_table(
            "measure_departments",
            sa.Column("id", sa.UUID(), primary_key=True),
            sa.Column("characteristic", sa.String(255), nullable=False, unique=True),
            sa.Column("department_name", sa.String(255), nullable=False),
            sa.Column("updated_by", sa.UUID(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        )
        op.create_index("ix_measure_departments_characteristic", "measure_departments", ["characteristic"])


def downgrade() -> None:
    if "measure_departments" in _tables():
        op.drop_table("measure_departments")

    nc = _cols("nonconformities")
    with op.batch_alter_table("nonconformities") as batch:
        if "sla_escalated_at" in nc:
            batch.drop_column("sla_escalated_at")
        if "sla_escalated" in nc:
            batch.drop_column("sla_escalated")

    pr = _cols("proposals")
    with op.batch_alter_table("proposals") as batch:
        if "llm_reviewed_at" in pr:
            batch.drop_column("llm_reviewed_at")
        if "llm_reviewed_by" in pr:
            batch.drop_constraint("fk_proposals_llm_reviewed_by", type_="foreignkey")
            batch.drop_column("llm_reviewed_by")
        if "measure_source" in pr:
            batch.drop_column("measure_source")
        if "department" in pr:
            batch.drop_column("department")
        if "systemic_scope_system_count" in pr:
            batch.drop_column("systemic_scope_system_count")
        if "systemic_scope_llm_note" in pr:
            batch.drop_column("systemic_scope_llm_note")
        if "systemic_scope_note" in pr:
            batch.drop_column("systemic_scope_note")
        if "alternative_solutions" in pr:
            batch.drop_column("alternative_solutions")
        if "ale_at_risk_current_at" in pr:
            batch.drop_column("ale_at_risk_current_at")
        if "ale_at_risk_current" in pr:
            batch.drop_column("ale_at_risk_current")
        if "ale_at_risk_snapshot_at" in pr:
            batch.drop_column("ale_at_risk_snapshot_at")
        if "ale_at_risk_snapshot" in pr:
            batch.drop_column("ale_at_risk_snapshot")
        if "is_blocking_override" in pr:
            batch.drop_column("is_blocking_override")
        if "is_process_measure" in pr:
            batch.drop_column("is_process_measure")
