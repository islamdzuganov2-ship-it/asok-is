"""ТЗ v19 Фаза 0 — фундамент управленческого контура (УК-12, УК-13, УК-21, УК-36)

Revision ID: 014
Revises: 013
Create Date: 2026-08-15

Три независимых, полностью аддитивных изменения — ни одно не меняет и не удаляет
существующие данные, все новые столбцы nullable, миграция обратима:

  · FK на users.id для ответственных (УК-12). Строковые `owner`/`executed_by`/`verified_by`
    ОСТАЮТСЯ как есть — это снимок отображаемого имени на момент записи, а не то, что
    заменяется. Новые `*_user_id` заполняются ОТДЕЛЬНЫМ скриптом
    `backend/app/scripts/match_owners_to_users.py` (dry-run по умолчанию, отчёт
    сопоставлено/не сопоставлено до применения — обязательное требование CLAUDE.md).
  · Даты как даты (УК-36): `proposals.due_on` — новый DateTime рядом со старым
    `due_date` (String, формат ДД.ММ.ГГГГ). Обратная совместимость API: `due_date` не
    удаляется, второй скрипт бэкафилла парсит его в `due_on`.
  · Профиль предприятия (УК-21, Р-4): одна запись-синглтон, не справочник организаций
    и не мультиарендность — см. docs/ТЗ_19_Управленческий_Контур_и_Веса.md §0 Р-4.

Заодно — поле трудоёмкости меры (УК-13/31, п.13): решение заказчика 15.08.2026 —
исполнитель проставляет часы вручную при переводе меры «в работу», это не отдельный
справочник, поэтому оно в этой же аддитивной миграции, а не в фазе 3.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "014"
down_revision = "013"
branch_labels = None
depends_on = None


def _cols(table: str) -> set[str]:
    """Идемпотентность по колонкам — тот же приём, что и в 013 (стенды с историей create_all)."""
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def _tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def upgrade() -> None:
    _upgrade_proposals()
    _upgrade_nonconformities()
    _upgrade_systems()
    if "enterprise_profile" not in _tables():
        _create_enterprise_profile()


def _upgrade_proposals() -> None:
    existing = _cols("proposals")
    with op.batch_alter_table("proposals") as batch:
        if "owner_user_id" not in existing:
            batch.add_column(sa.Column("owner_user_id", sa.UUID(), nullable=True))
            batch.create_foreign_key(
                "fk_proposals_owner_user_id", "users", ["owner_user_id"], ["id"],
            )
            batch.create_index("ix_proposals_owner_user_id", ["owner_user_id"])
        if "due_on" not in existing:
            batch.add_column(sa.Column("due_on", sa.DateTime(timezone=True), nullable=True))
        if "executed_by_user_id" not in existing:
            batch.add_column(sa.Column("executed_by_user_id", sa.UUID(), nullable=True))
            batch.create_foreign_key(
                "fk_proposals_executed_by_user_id", "users", ["executed_by_user_id"], ["id"],
            )
            batch.create_index("ix_proposals_executed_by_user_id", ["executed_by_user_id"])
        if "effort_hours" not in existing:
            batch.add_column(sa.Column("effort_hours", sa.Numeric(8, 2), nullable=True))
        if "effort_hours_set_by" not in existing:
            batch.add_column(sa.Column("effort_hours_set_by", sa.UUID(), nullable=True))
            batch.create_foreign_key(
                "fk_proposals_effort_hours_set_by", "users", ["effort_hours_set_by"], ["id"],
            )
        if "effort_hours_set_at" not in existing:
            batch.add_column(sa.Column("effort_hours_set_at", sa.DateTime(timezone=True), nullable=True))


def _upgrade_nonconformities() -> None:
    existing = _cols("nonconformities")
    with op.batch_alter_table("nonconformities") as batch:
        if "owner_user_id" not in existing:
            batch.add_column(sa.Column("owner_user_id", sa.UUID(), nullable=True))
            batch.create_foreign_key(
                "fk_nonconformities_owner_user_id", "users", ["owner_user_id"], ["id"],
            )
            batch.create_index("ix_nonconformities_owner_user_id", ["owner_user_id"])
        if "executed_by_user_id" not in existing:
            batch.add_column(sa.Column("executed_by_user_id", sa.UUID(), nullable=True))
            batch.create_foreign_key(
                "fk_nonconformities_executed_by_user_id", "users", ["executed_by_user_id"], ["id"],
            )
            batch.create_index("ix_nonconformities_executed_by_user_id", ["executed_by_user_id"])
        if "verified_by_user_id" not in existing:
            batch.add_column(sa.Column("verified_by_user_id", sa.UUID(), nullable=True))
            batch.create_foreign_key(
                "fk_nonconformities_verified_by_user_id", "users", ["verified_by_user_id"], ["id"],
            )
            batch.create_index("ix_nonconformities_verified_by_user_id", ["verified_by_user_id"])


def _upgrade_systems() -> None:
    existing = _cols("systems")
    if "owner_user_id" not in existing:
        with op.batch_alter_table("systems") as batch:
            batch.add_column(sa.Column("owner_user_id", sa.UUID(), nullable=True))
            batch.create_foreign_key(
                "fk_systems_owner_user_id", "users", ["owner_user_id"], ["id"],
            )
            batch.create_index("ix_systems_owner_user_id", ["owner_user_id"])


def _create_enterprise_profile() -> None:
    op.create_table(
        "enterprise_profile",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=True),
        sa.Column("size_class", sa.String(length=16), nullable=True),
        sa.Column("revenue_annual", sa.Numeric(18, 2), nullable=True),
        sa.Column("headcount", sa.Integer(), nullable=True),
        sa.Column("industry", sa.String(length=255), nullable=True),
        sa.Column("region", sa.String(length=255), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("updated_by", sa.UUID(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True),
                  server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["updated_by"], ["users.id"]),
    )


def downgrade() -> None:
    if "enterprise_profile" in _tables():
        op.drop_table("enterprise_profile")

    if "owner_user_id" in _cols("systems"):
        with op.batch_alter_table("systems") as batch:
            batch.drop_constraint("fk_systems_owner_user_id", type_="foreignkey")
            batch.drop_index("ix_systems_owner_user_id")
            batch.drop_column("owner_user_id")

    nc = _cols("nonconformities")
    with op.batch_alter_table("nonconformities") as batch:
        if "verified_by_user_id" in nc:
            batch.drop_constraint("fk_nonconformities_verified_by_user_id", type_="foreignkey")
            batch.drop_index("ix_nonconformities_verified_by_user_id")
            batch.drop_column("verified_by_user_id")
        if "executed_by_user_id" in nc:
            batch.drop_constraint("fk_nonconformities_executed_by_user_id", type_="foreignkey")
            batch.drop_index("ix_nonconformities_executed_by_user_id")
            batch.drop_column("executed_by_user_id")
        if "owner_user_id" in nc:
            batch.drop_constraint("fk_nonconformities_owner_user_id", type_="foreignkey")
            batch.drop_index("ix_nonconformities_owner_user_id")
            batch.drop_column("owner_user_id")

    pr = _cols("proposals")
    with op.batch_alter_table("proposals") as batch:
        if "effort_hours_set_at" in pr:
            batch.drop_column("effort_hours_set_at")
        if "effort_hours_set_by" in pr:
            batch.drop_constraint("fk_proposals_effort_hours_set_by", type_="foreignkey")
            batch.drop_column("effort_hours_set_by")
        if "effort_hours" in pr:
            batch.drop_column("effort_hours")
        if "executed_by_user_id" in pr:
            batch.drop_constraint("fk_proposals_executed_by_user_id", type_="foreignkey")
            batch.drop_index("ix_proposals_executed_by_user_id")
            batch.drop_column("executed_by_user_id")
        if "due_on" in pr:
            batch.drop_column("due_on")
        if "owner_user_id" in pr:
            batch.drop_constraint("fk_proposals_owner_user_id", type_="foreignkey")
            batch.drop_index("ix_proposals_owner_user_id")
            batch.drop_column("owner_user_id")
