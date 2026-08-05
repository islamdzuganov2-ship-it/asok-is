"""Risk-economic contour foundation (BL-007): econ reference data, risk_event, nonconformity,
incident/proposal economic fields, systems.vendor.

Глобальный слой данных риск-экономического контура (RE-01…RE-05, RE-08, RE-11, RE-14). NB: в рабочем
стеке схема создаётся через create_all на старте; миграция — для консистентности alembic-истории
(в проде — реальное изменение схемы). Добавляемые NOT NULL-поля в заполненные таблицы идут с
server_default, чтобы upgrade проходил на непустой БД.

Revision ID: 011
Revises: 010
Create Date: 2026-08-05 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "011"
down_revision = "010"
branch_labels = None
depends_on = None

UUID = postgresql.UUID(as_uuid=True)
JSONB = postgresql.JSONB


def _ts_cols() -> list:
    """created_at/updated_at из TimestampMixin (server-side now())."""
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    ]


def upgrade() -> None:
    # ── systems.vendor (RE-01) ──
    op.add_column("systems", sa.Column("vendor", sa.String(255), nullable=True))

    # ── econ: бизнес-процессы + связь ИС↔БП + стоимость минуты (RE-01, RE-02) ──
    op.create_table(
        "business_processes",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("code", sa.String(50), nullable=False, unique=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False, server_default="BACKOFFICE"),
        sa.Column("owner", sa.String(255), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        *_ts_cols(),
    )
    op.create_index("ix_business_processes_code", "business_processes", ["code"])

    op.create_table(
        "system_business_processes",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("system_id", UUID, sa.ForeignKey("systems.id"), nullable=False),
        sa.Column("business_process_id", UUID, sa.ForeignKey("business_processes.id"), nullable=False),
        sa.Column("share", sa.Numeric(5, 4), nullable=False, server_default="1"),
        sa.Column("default_k_impact", sa.Numeric(5, 4), nullable=True),
        *_ts_cols(),
        sa.UniqueConstraint("system_id", "business_process_id", name="uq_system_bp"),
    )
    op.create_index("ix_system_business_processes_system_id", "system_business_processes", ["system_id"])
    op.create_index("ix_system_business_processes_business_process_id",
                    "system_business_processes", ["business_process_id"])

    op.create_table(
        "business_process_costs",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("business_process_id", UUID, sa.ForeignKey("business_processes.id"), nullable=False),
        sa.Column("method", sa.String(16), nullable=False, server_default="RESOURCE"),
        sa.Column("params", JSONB, nullable=True),
        sa.Column("time_profile", JSONB, nullable=True),
        sa.Column("cost_per_min_base", sa.Numeric(14, 4), nullable=True),
        sa.Column("currency", sa.String(8), nullable=False, server_default="RUB"),
        sa.Column("note", sa.Text(), nullable=True),
        *_ts_cols(),
        sa.UniqueConstraint("business_process_id", name="uq_bp_cost"),
    )
    op.create_index("ix_business_process_costs_business_process_id",
                    "business_process_costs", ["business_process_id"])

    # ── econ: ставки сопровождения L1/L2/L3 (RE-03) ──
    op.create_table(
        "support_rates",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("system_id", UUID, sa.ForeignKey("systems.id"), nullable=True),
        sa.Column("line", sa.String(4), nullable=False),
        sa.Column("executor_type", sa.String(16), nullable=False, server_default="INTERNAL"),
        sa.Column("vendor", sa.String(255), nullable=True),
        sa.Column("mode", sa.String(16), nullable=True),
        sa.Column("rate_per_hour", sa.Numeric(14, 2), nullable=False),
        sa.Column("k_evening", sa.Numeric(5, 2), nullable=False, server_default="1.5"),
        sa.Column("k_weekend", sa.Numeric(5, 2), nullable=False, server_default="2.0"),
        sa.Column("package_hours", sa.Numeric(12, 2), nullable=True),
        sa.Column("overlimit_rate", sa.Numeric(14, 2), nullable=True),
        sa.Column("billing_quantum_min", sa.Numeric(6, 0), nullable=False, server_default="60"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        *_ts_cols(),
    )
    op.create_index("ix_support_rates_system_id", "support_rates", ["system_id"])
    op.create_index("ix_support_rates_line", "support_rates", ["line"])

    # ── econ: финпараметры контура (RE-04) ──
    op.create_table(
        "econ_config",
        sa.Column("key", sa.String(64), primary_key=True),
        sa.Column("value", JSONB, nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        *_ts_cols(),
    )

    # ── risk_events (RE-08): числовой контур ARO/ALE ──
    op.create_table(
        "risk_events",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("code", sa.String(), nullable=False, unique=True),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("category", sa.String(), nullable=True),
        sa.Column("owner", sa.String(), nullable=True),
        sa.Column("system_id", UUID, nullable=True),
        sa.Column("risk_base_id", UUID, sa.ForeignKey("risk_base.id"), nullable=True),
        sa.Column("aro", sa.Numeric(10, 4), nullable=True),
        sa.Column("aro_is_expert", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("sle_expert", sa.Numeric(16, 2), nullable=True),
        sa.Column("ale_avg", sa.Numeric(16, 2), nullable=True),
        sa.Column("ale_p90", sa.Numeric(16, 2), nullable=True),
        sa.Column("max_sle", sa.Numeric(16, 2), nullable=True),
        sa.Column("risk_appetite", sa.Numeric(16, 2), nullable=True),
        sa.Column("regulatory", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("status", sa.String(), nullable=False, server_default="active"),
        sa.Column("created_by", sa.String(), nullable=True),
        *_ts_cols(),
    )
    op.create_index("ix_risk_events_code", "risk_events", ["code"])
    op.create_index("ix_risk_events_category", "risk_events", ["category"])
    op.create_index("ix_risk_events_system_id", "risk_events", ["system_id"])
    op.create_index("ix_risk_events_status", "risk_events", ["status"])

    op.create_table(
        "risk_event_subchars",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("risk_event_id", UUID, sa.ForeignKey("risk_events.id", ondelete="CASCADE"), nullable=False),
        sa.Column("characteristic", sa.String(), nullable=False),
        sa.Column("subcharacteristic", sa.String(), nullable=False),
        sa.UniqueConstraint("risk_event_id", "characteristic", "subcharacteristic", name="uq_risk_subchar"),
    )
    op.create_index("ix_risk_event_subchars_risk_event_id", "risk_event_subchars", ["risk_event_id"])

    op.create_table(
        "risk_event_incidents",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("risk_event_id", UUID, sa.ForeignKey("risk_events.id", ondelete="CASCADE"), nullable=False),
        sa.Column("incident_id", UUID, sa.ForeignKey("tech_incidents.id", ondelete="CASCADE"), nullable=False),
        sa.UniqueConstraint("risk_event_id", "incident_id", name="uq_risk_incident"),
    )
    op.create_index("ix_risk_event_incidents_risk_event_id", "risk_event_incidents", ["risk_event_id"])
    op.create_index("ix_risk_event_incidents_incident_id", "risk_event_incidents", ["incident_id"])

    op.create_table(
        "risk_event_measures",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("risk_event_id", UUID, sa.ForeignKey("risk_events.id", ondelete="CASCADE"), nullable=False),
        sa.Column("proposal_id", UUID, sa.ForeignKey("proposals.id", ondelete="CASCADE"), nullable=False),
        sa.Column("ale_reduction_share", sa.Numeric(5, 4), nullable=True),
        sa.UniqueConstraint("risk_event_id", "proposal_id", name="uq_risk_measure"),
    )
    op.create_index("ix_risk_event_measures_risk_event_id", "risk_event_measures", ["risk_event_id"])
    op.create_index("ix_risk_event_measures_proposal_id", "risk_event_measures", ["proposal_id"])

    # ── tech_incidents: экономический слой (RE-05) ──
    op.add_column("tech_incidents", sa.Column("incident_type", sa.String(16), nullable=False,
                                              server_default="DOWNTIME"))
    op.add_column("tech_incidents", sa.Column("degradation_type", sa.String(16), nullable=True))
    op.add_column("tech_incidents", sa.Column("downtime_minutes", sa.Numeric(12, 2), nullable=True))
    op.add_column("tech_incidents", sa.Column("k_impact", sa.Numeric(5, 4), nullable=True))
    op.add_column("tech_incidents", sa.Column("t_reaction_min", sa.Numeric(12, 2), nullable=True))
    op.add_column("tech_incidents", sa.Column("t_resolution_min", sa.Numeric(12, 2), nullable=True))
    op.add_column("tech_incidents", sa.Column("t_target_min", sa.Numeric(12, 2), nullable=True))
    op.add_column("tech_incidents", sa.Column("root_cause_fixed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("tech_incidents", sa.Column("labor_l1_hours", sa.Numeric(10, 2), nullable=True))
    op.add_column("tech_incidents", sa.Column("labor_l2_hours", sa.Numeric(10, 2), nullable=True))
    op.add_column("tech_incidents", sa.Column("labor_l3_hours", sa.Numeric(10, 2), nullable=True))
    op.add_column("tech_incidents", sa.Column("vendor_involved", sa.Boolean(), nullable=False,
                                              server_default=sa.false()))
    op.add_column("tech_incidents", sa.Column("cost_total", sa.Numeric(16, 2), nullable=True))

    # ── proposals: экономический слой меры + вердикт (RE-11) ──
    op.add_column("proposals", sa.Column("measure_type", sa.String(16), nullable=True))
    op.add_column("proposals", sa.Column("capex", sa.Numeric(16, 2), nullable=True))
    op.add_column("proposals", sa.Column("opex_per_year", sa.Numeric(16, 2), nullable=True))
    op.add_column("proposals", sa.Column("implementation_months", sa.Numeric(6, 2), nullable=True))
    op.add_column("proposals", sa.Column("expected_delta_score", sa.Numeric(6, 2), nullable=True))
    op.add_column("proposals", sa.Column("delta_ale_cash", sa.Numeric(16, 2), nullable=True))
    op.add_column("proposals", sa.Column("delta_ale_deferred", sa.Numeric(16, 2), nullable=True))
    op.add_column("proposals", sa.Column("delta_ale_capacity", sa.Numeric(16, 2), nullable=True))
    op.add_column("proposals", sa.Column("rosi", sa.Numeric(10, 4), nullable=True))
    op.add_column("proposals", sa.Column("recommended_verdict", sa.String(16), nullable=True))
    op.add_column("proposals", sa.Column("verdict", sa.String(16), nullable=True))

    # ── nonconformities (RE-14): хребет замыкания контура ──
    op.create_table(
        "nonconformities",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("code", sa.String(50), nullable=True, unique=True),
        sa.Column("system_id", UUID, nullable=True),
        sa.Column("system_name", sa.String(255), nullable=False),
        sa.Column("characteristic", sa.String(255), nullable=False),
        sa.Column("subcharacteristic", sa.String(255), nullable=False),
        sa.Column("assessment_value_id", UUID, nullable=True),
        sa.Column("evidence_type", sa.String(4), nullable=True),
        sa.Column("level", sa.String(16), nullable=False, server_default="MAJOR"),
        sa.Column("is_blocking", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", sa.String(24), nullable=False, server_default="IDENTIFIED"),
        sa.Column("owner", sa.String(255), nullable=False),
        sa.Column("evaluated_ale", sa.Numeric(16, 2), nullable=True),
        sa.Column("risk_event_id", UUID, sa.ForeignKey("risk_events.id"), nullable=True),
        sa.Column("proposal_id", UUID, sa.ForeignKey("proposals.id"), nullable=True),
        sa.Column("decision_verdict", sa.String(16), nullable=True),
        sa.Column("acceptance_level", sa.String(32), nullable=True),
        sa.Column("signed_by", sa.String(255), nullable=True),
        sa.Column("sla_due", sa.DateTime(timezone=True), nullable=True),
        sa.Column("review_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("executed_by", sa.String(255), nullable=True),
        sa.Column("executed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("verified_by", sa.String(255), nullable=True),
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("delta_score_confirmed", sa.Numeric(6, 2), nullable=True),
        sa.Column("history", JSONB, nullable=True),
        sa.Column("is_demo", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_by", sa.String(255), nullable=True),
        *_ts_cols(),
    )
    op.create_index("ix_nonconformities_system_id", "nonconformities", ["system_id"])
    op.create_index("ix_nonconformities_status", "nonconformities", ["status"])
    op.create_index("ix_nonconformities_risk_event_id", "nonconformities", ["risk_event_id"])
    op.create_index("ix_nonconformities_proposal_id", "nonconformities", ["proposal_id"])


def downgrade() -> None:
    op.drop_table("nonconformities")
    for col in ("verdict", "recommended_verdict", "rosi", "delta_ale_capacity", "delta_ale_deferred",
                "delta_ale_cash", "expected_delta_score", "implementation_months", "opex_per_year",
                "capex", "measure_type"):
        op.drop_column("proposals", col)
    for col in ("cost_total", "vendor_involved", "labor_l3_hours", "labor_l2_hours", "labor_l1_hours",
                "root_cause_fixed_at", "t_target_min", "t_resolution_min", "t_reaction_min",
                "k_impact", "downtime_minutes", "degradation_type", "incident_type"):
        op.drop_column("tech_incidents", col)
    op.drop_table("risk_event_measures")
    op.drop_table("risk_event_incidents")
    op.drop_table("risk_event_subchars")
    op.drop_table("risk_events")
    op.drop_table("econ_config")
    op.drop_table("support_rates")
    op.drop_table("business_process_costs")
    op.drop_table("system_business_processes")
    op.drop_table("business_processes")
    op.drop_column("systems", "vendor")
