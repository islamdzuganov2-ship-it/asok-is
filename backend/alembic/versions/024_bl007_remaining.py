"""BL-007 — оставшиеся задачи RE: экономика сбоя (RE-03/05/06), антигейминг метрик (RE-20),
роль аналитика (RE-19), задел ITSM (RE-23…RE-26)

Revision ID: 024
Revises: 023
Create Date: 2026-09-25

Аддитивно, все новые колонки nullable (или с server_default) — существующие строки не трогаются.

tech_incidents:
  • cost_breakdown JSONB           — разложение C_ТС (восстановление/простой/вторичные, по линиям);
  • degradation_inputs JSONB       — входы расчёта K по типу деградации (RE-06);
  • counts_as_downtime BOOL        — итог правила «деградация → простой» (RE-06);
  • labor_vendor_lines JSONB       — линии, закрытые вендором (RE-03: ставка по исполнителю);
  • labor_source VARCHAR(24)       — ввод аналитика / восстановлено из журнала переназначений (RE-24);
  • external_id VARCHAR(128)       — номер тикета ITSM (RE-23);
  • parent_incident_id UUID        — дочерний тикет того же сбоя (RE-26).
proposals.delta_ale_at_decision   — ΔALE, зафиксированный при одобрении (RE-20, антигейминг).
assessment_periods: depth, analyst_hours, carried_from_period_id (RE-19).
assessment_values.carried_over    — значение перенесено при дельта-переоценке (RE-19).
Новые таблицы: owner_checklist_items (RE-19), itsm_group_mappings, system_aliases (RE-25).
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "024"
down_revision = "023"
branch_labels = None
depends_on = None

_UUID = postgresql.UUID(as_uuid=True)
_JSONB = postgresql.JSONB()

_COLUMNS = {
    "tech_incidents": (
        ("cost_breakdown", _JSONB, {}),
        ("degradation_inputs", _JSONB, {}),
        ("counts_as_downtime", sa.Boolean(), {}),
        ("labor_vendor_lines", _JSONB, {}),
        ("labor_source", sa.String(24), {}),
        ("external_id", sa.String(128), {}),
        ("parent_incident_id", _UUID, {}),
    ),
    "proposals": (
        ("delta_ale_at_decision", sa.Numeric(16, 2), {}),
    ),
    "assessment_periods": (
        ("depth", sa.String(16), {}),
        ("analyst_hours", sa.Numeric(8, 2), {}),
        ("carried_from_period_id", _UUID, {}),
    ),
    "assessment_values": (
        ("carried_over", sa.Boolean(), {"server_default": sa.false(), "nullable": False}),
    ),
}
_INDEXES = (
    ("ix_tech_incidents_external_id", "tech_incidents", "external_id"),
    ("ix_tech_incidents_parent_incident_id", "tech_incidents", "parent_incident_id"),
)


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
    have = {i["name"] for t in ("tech_incidents",) for i in sa.inspect(op.get_bind()).get_indexes(t)}
    for name, table, col in _INDEXES:
        if name not in have:
            op.create_index(name, table, [col])

    tables = _tables()
    if "owner_checklist_items" not in tables:
        op.create_table(
            "owner_checklist_items",
            sa.Column("id", _UUID, primary_key=True),
            sa.Column("period_id", _UUID, sa.ForeignKey("assessment_periods.id", ondelete="CASCADE"), nullable=False),
            sa.Column("characteristic", sa.String(255), nullable=False),
            sa.Column("subcharacteristic", sa.String(255), nullable=False),
            sa.Column("question", sa.Text(), nullable=False),
            sa.Column("answer", sa.Text(), nullable=True),
            sa.Column("artifact_url", sa.String(1024), nullable=True),
            sa.Column("submitted_by", sa.String(255), nullable=True),
            sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("sampled", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("verification", sa.String(16), nullable=False, server_default="PENDING"),
            sa.Column("verified_by", sa.String(255), nullable=True),
            sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("verifier_comment", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.UniqueConstraint("period_id", "characteristic", "subcharacteristic", name="uq_checklist_pair"),
        )
        op.create_index("ix_owner_checklist_items_id", "owner_checklist_items", ["id"])
        op.create_index("ix_owner_checklist_items_period_id", "owner_checklist_items", ["period_id"])
    if "itsm_group_mappings" not in tables:
        op.create_table(
            "itsm_group_mappings",
            sa.Column("id", _UUID, primary_key=True),
            sa.Column("group_name", sa.String(255), nullable=False, unique=True),
            sa.Column("system_id", _UUID, sa.ForeignKey("systems.id"), nullable=False),
            sa.Column("note", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )
        op.create_index("ix_itsm_group_mappings_group_name", "itsm_group_mappings", ["group_name"])
    if "system_aliases" not in tables:
        op.create_table(
            "system_aliases",
            sa.Column("id", _UUID, primary_key=True),
            sa.Column("alias", sa.String(255), nullable=False),
            sa.Column("alias_norm", sa.String(255), nullable=False),
            sa.Column("system_id", _UUID, sa.ForeignKey("systems.id"), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.UniqueConstraint("alias_norm", name="uq_system_alias_norm"),
        )
        op.create_index("ix_system_aliases_alias_norm", "system_aliases", ["alias_norm"])


def downgrade() -> None:
    tables = _tables()
    for t in ("system_aliases", "itsm_group_mappings", "owner_checklist_items"):
        if t in tables:
            op.drop_table(t)
    for name, table, _ in _INDEXES:
        op.execute(f"DROP INDEX IF EXISTS {name}")
    for table, columns in _COLUMNS.items():
        existing = _cols(table)
        for name, _type, _extra in columns:
            if name in existing:
                op.drop_column(table, name)
