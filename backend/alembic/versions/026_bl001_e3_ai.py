"""BL-001 E3 — контур СИИ (ГОСТ Р 59898-2021): тестовые наборы и выбросы, паритет сред,
экспертная группа, справочник узлов модели качества

Revision ID: 026
Revises: 025
Create Date: 2026-09-26

Новые таблицы (аддитивно):
  • ai_test_datasets — метаданные тестового набора и критерий выбросов (разд. 9);
  • ai_env_parity    — паритет тестовой и эксплуатационной сред по факторам табл. 3;
  • ai_expert_scores — оценки экспертов группы (согласованность — W Кендалла);
  • qm_nodes         — справочник узлов моделей ISO 25010 и ГОСТ 59898 (заполняется из кода).

Права по умолчанию для уже наполненной матрицы (продуктивная установка без DEMO_MODE, где
стартовый сид не запускается): новое право `ai.expert.evaluate` и право `assessment.checklist.fill`
(RE-19) получают роли по умолчанию, ТОЛЬКО если право ещё не встречается ни у одной роли —
то же правило, что у seed_rbac_defaults: осознанные решения суперадмина не перезаписываются.
"""
import uuid

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "026"
down_revision = "025"
branch_labels = None
depends_on = None

_UUID = postgresql.UUID(as_uuid=True)
_TS = dict(server_default=sa.func.now(), nullable=False)
_DEFAULT_GRANTS = {
    "ai.expert.evaluate": ("QUALITY_MANAGER", "TEST_ANALYST"),
    "assessment.checklist.fill": ("QUALITY_MANAGER", "TEST_ANALYST", "EXECUTOR"),
}


def _tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def upgrade() -> None:
    tables = _tables()
    if "ai_test_datasets" not in tables:
        op.create_table(
            "ai_test_datasets",
            sa.Column("id", _UUID, primary_key=True),
            sa.Column("period_id", _UUID, sa.ForeignKey("assessment_periods.id", ondelete="CASCADE"), nullable=False),
            sa.Column("name", sa.String(255), nullable=False),
            sa.Column("purpose", sa.String(16), nullable=False, server_default="TEST"),
            sa.Column("records", sa.Integer(), nullable=True),
            sa.Column("source", sa.Text(), nullable=True),
            sa.Column("collected_from", sa.String(32), nullable=True),
            sa.Column("representativeness", sa.Text(), nullable=True),
            sa.Column("class_balance", postgresql.JSONB(), nullable=True),
            sa.Column("outlier_method", sa.String(16), nullable=True),
            sa.Column("outlier_k", sa.Numeric(6, 3), nullable=True),
            sa.Column("outlier_feature", sa.String(255), nullable=True),
            sa.Column("outliers_count", sa.Integer(), nullable=True),
            sa.Column("outliers_share", sa.Numeric(6, 4), nullable=True),
            sa.Column("outlier_handling", sa.String(16), nullable=True),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), **_TS),
            sa.Column("updated_at", sa.DateTime(timezone=True), **_TS),
        )
        op.create_index("ix_ai_test_datasets_id", "ai_test_datasets", ["id"])
        op.create_index("ix_ai_test_datasets_period_id", "ai_test_datasets", ["period_id"])
    if "ai_env_parity" not in tables:
        op.create_table(
            "ai_env_parity",
            sa.Column("id", _UUID, primary_key=True),
            sa.Column("period_id", _UUID, sa.ForeignKey("assessment_periods.id", ondelete="CASCADE"), nullable=False),
            sa.Column("factor", sa.String(32), nullable=False),
            sa.Column("test_env", sa.Text(), nullable=True),
            sa.Column("prod_env", sa.Text(), nullable=True),
            sa.Column("status", sa.String(16), nullable=False),
            sa.Column("justification", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), **_TS),
            sa.Column("updated_at", sa.DateTime(timezone=True), **_TS),
            sa.UniqueConstraint("period_id", "factor", name="uq_ai_env_parity_factor"),
        )
        op.create_index("ix_ai_env_parity_id", "ai_env_parity", ["id"])
        op.create_index("ix_ai_env_parity_period_id", "ai_env_parity", ["period_id"])
    if "ai_expert_scores" not in tables:
        op.create_table(
            "ai_expert_scores",
            sa.Column("id", _UUID, primary_key=True),
            sa.Column("period_id", _UUID, sa.ForeignKey("assessment_periods.id", ondelete="CASCADE"), nullable=False),
            sa.Column("characteristic", sa.String(255), nullable=False),
            sa.Column("subcharacteristic", sa.String(255), nullable=False),
            sa.Column("expert", sa.String(100), nullable=False),
            sa.Column("expert_name", sa.String(255), nullable=True),
            sa.Column("score", sa.Numeric(6, 2), nullable=False),
            sa.Column("comment", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), **_TS),
            sa.Column("updated_at", sa.DateTime(timezone=True), **_TS),
            sa.UniqueConstraint("period_id", "characteristic", "subcharacteristic", "expert", name="uq_ai_expert_score"),
        )
        op.create_index("ix_ai_expert_scores_id", "ai_expert_scores", ["id"])
        op.create_index("ix_ai_expert_scores_period_id", "ai_expert_scores", ["period_id"])
    if "qm_nodes" not in tables:
        op.create_table(
            "qm_nodes",
            sa.Column("id", _UUID, primary_key=True),
            sa.Column("model_kind", sa.String(16), nullable=False),
            sa.Column("level", sa.String(20), nullable=False),
            sa.Column("parent_id", _UUID, sa.ForeignKey("qm_nodes.id", ondelete="CASCADE"), nullable=True),
            sa.Column("code", sa.String(32), nullable=False),
            sa.Column("name_ru", sa.String(255), nullable=False),
            sa.Column("metric_kind", sa.String(20), nullable=True),
            sa.Column("is_ai_specific", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("sort", sa.Integer(), nullable=False, server_default="0"),
        )
        op.create_index("ix_qm_nodes_model_kind", "qm_nodes", ["model_kind"])
        op.create_index("ix_qm_nodes_parent_id", "qm_nodes", ["parent_id"])
        _seed_qm_nodes()
    _grant_new_permissions()


def _seed_qm_nodes() -> None:
    """Заполнение из моделей в коде — чистые константы без ORM, импорт в миграции безопасен."""
    from app.modules.quality.qm_nodes import model_nodes

    table = sa.table(
        "qm_nodes", sa.column("id", _UUID), sa.column("model_kind", sa.String), sa.column("level", sa.String),
        sa.column("parent_id", _UUID), sa.column("code", sa.String), sa.column("name_ru", sa.String),
        sa.column("metric_kind", sa.String), sa.column("is_ai_specific", sa.Boolean), sa.column("sort", sa.Integer),
    )
    ids: dict[tuple[str, str], uuid.UUID] = {}
    rows = []
    for spec in model_nodes():
        node_id = uuid.uuid4()
        ids[(spec["model_kind"], spec["code"])] = node_id
        rows.append({
            "id": node_id, "model_kind": spec["model_kind"], "level": spec["level"],
            "parent_id": ids.get((spec["model_kind"], spec["parent"])) if spec["parent"] else None,
            "code": spec["code"], "name_ru": spec["name_ru"], "metric_kind": spec["metric_kind"],
            "is_ai_specific": spec["is_ai_specific"], "sort": spec["sort"],
        })
    op.bulk_insert(table, rows)


def _grant_new_permissions() -> None:
    if "role_permissions" not in _tables():
        return
    bind = op.get_bind()
    if not bind.execute(sa.text("SELECT 1 FROM role_permissions LIMIT 1")).first():
        return   # пустая матрица — её целиком заполнит seed_rbac_defaults при первом запуске
    for permission, roles in _DEFAULT_GRANTS.items():
        if bind.execute(sa.text("SELECT 1 FROM role_permissions WHERE permission = :p LIMIT 1"),
                        {"p": permission}).first():
            continue
        for role in roles:
            bind.execute(sa.text(
                "INSERT INTO role_permissions (id, role, permission) VALUES (:id, :r, :p) "
                "ON CONFLICT ON CONSTRAINT uq_role_permission DO NOTHING"
            ), {"id": uuid.uuid4(), "r": role, "p": permission})


def downgrade() -> None:
    tables = _tables()
    for t in ("qm_nodes", "ai_expert_scores", "ai_env_parity", "ai_test_datasets"):
        if t in tables:
            op.drop_table(t)
