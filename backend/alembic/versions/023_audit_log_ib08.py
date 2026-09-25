"""ИБ-08 — журнал событий ИБ: недостающие поля audit_log и запрет UPDATE/DELETE/TRUNCATE

Revision ID: 023
Revises: 022
Create Date: 2026-09-24

Аддитивно. Таблица audit_log создана миграцией 013, но в неё не писалось ничего (SEC-03).
Для расследования не хватало: логина на момент события (переживает удаление пользователя),
исхода (успех/отказ), User-Agent, сквозного request_id и ключа не-UUID сущности (роль,
право, вид выгрузки). Append-only закрепляется триггерами на стороне БД — журнал нельзя
«подчистить» из приложения, в том числе при компрометации его учётной записи БД.
Тот же SQL триггеров выполняется для баз, создаваемых create_all (iam/models.py).
"""
from alembic import op
import sqlalchemy as sa

revision = "023"
down_revision = "022"
branch_labels = None
depends_on = None

_NEW_COLUMNS = (
    ("username", sa.String(100)),
    ("outcome", sa.String(16)),
    ("entity_key", sa.String(255)),
    ("user_agent", sa.String(512)),
    ("request_id", sa.String(64)),
)
# Копия iam/models.py::AUDIT_APPEND_ONLY_SQL на дату миграции: миграция не должна зависеть
# от того, как код модели будет выглядеть позже.
_APPEND_ONLY_SQL = (
    """
    CREATE OR REPLACE FUNCTION audit_log_append_only() RETURNS trigger AS $$
    BEGIN
        RAISE EXCEPTION USING MESSAGE = 'audit_log is append-only: ' || TG_OP || ' is forbidden';
    END;
    $$ LANGUAGE plpgsql
    """,
    "DROP TRIGGER IF EXISTS audit_log_no_update_delete ON audit_log",
    """
    CREATE TRIGGER audit_log_no_update_delete BEFORE UPDATE OR DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION audit_log_append_only()
    """,
    "DROP TRIGGER IF EXISTS audit_log_no_truncate ON audit_log",
    """
    CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log
    FOR EACH STATEMENT EXECUTE FUNCTION audit_log_append_only()
    """,
)
_INDEXES = (
    ("ix_audit_log_created_at", "created_at"),
    ("ix_audit_log_user_id", "user_id"),
    ("ix_audit_log_action", "action"),
)


def _cols() -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns("audit_log")}


def _indexes() -> set[str]:
    return {i["name"] for i in sa.inspect(op.get_bind()).get_indexes("audit_log")}


def upgrade() -> None:
    existing = _cols()
    for name, type_ in _NEW_COLUMNS:
        if name not in existing:
            op.add_column("audit_log", sa.Column(name, type_, nullable=True))
    have = _indexes()
    for name, col in _INDEXES:
        if name not in have:
            op.create_index(name, "audit_log", [col])
    for stmt in _APPEND_ONLY_SQL:
        op.execute(stmt)


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS audit_log_no_update_delete ON audit_log")
    op.execute("DROP TRIGGER IF EXISTS audit_log_no_truncate ON audit_log")
    op.execute("DROP FUNCTION IF EXISTS audit_log_append_only()")
    have = _indexes()
    for name, _ in _INDEXES:
        if name in have:
            op.drop_index(name, table_name="audit_log")
    existing = _cols()
    for name, _ in _NEW_COLUMNS:
        if name in existing:
            op.drop_column("audit_log", name)
