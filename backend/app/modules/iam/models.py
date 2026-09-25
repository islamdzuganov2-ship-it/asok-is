"""
ORM-модели домена iam (ТЗ v13): пользователь и журнал аудита. Роли и SoD — по ролевой модели v12.
"""
import uuid
from datetime import datetime

from sqlalchemy import DDL, Boolean, DateTime, String, UniqueConstraint, event, func
from sqlalchemy.dialects.postgresql import INET, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.infrastructure.database import Base
from app.shared.db import SoftDeleteMixin, TimestampMixin


class User(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "users"
    ROLE_ANALYST = "TEST_ANALYST"
    ROLE_MANAGER = "QUALITY_MANAGER"
    ROLE_CTO = "CTO"
    ROLE_CEO = "CEO"
    ROLE_ADMIN = "ADMIN"
    # BL-007: владелец риска (RE-17) ведёт реестр рисков/ARO/аппетит, но НЕ меняет Score (SoD §6.1);
    # аудитор-верификатор (RE-18) ставит статус «Верифицировано» — тот, кто оценивал, не подтверждает
    # собственную меру (§3.3). Роли разведены в модели данных сразу, даже если носит их один человек.
    ROLE_RISK_MANAGER = "RISK_MANAGER"
    ROLE_AUDITOR = "AUDITOR"
    # BL-008: супер-администратор — единственный, кто заводит пользователей и раздаёт права
    # (матрица role_permissions). Стоит НАД ADMIN; в резолвере прав всегда получает весь каталог.
    ROLE_SUPER_ADMIN = "SUPER_ADMIN"
    # ДЕФ-10 (БТ-015, 2026-08-04): исполнитель — тот, НА КОГО назначается мера. Видит свои
    # поручения и тот же состав дашбордов, что топ-менеджмент, но решений по мерам не принимает:
    # он задаёт уточнения и предлагает перенос срока с обоснованием — решает менеджер по качеству.
    ROLE_EXECUTOR = "EXECUTOR"
    ALL_ROLES = ("TEST_ANALYST", "QUALITY_MANAGER", "CTO", "CEO", "ADMIN",
                 "RISK_MANAGER", "AUDITOR", "EXECUTOR", "SUPER_ADMIN")
    READONLY_ROLES = ("CTO", "CEO")

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    username: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    email: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    role: Mapped[str] = mapped_column(String(50), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    last_login: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AuditLog(Base):
    """Журнал событий информационной безопасности (ИБ-08; SEC-03). Append-only.

    Кто (user_id + username — логин на момент события, переживает удаление пользователя) /
    что (action — код из iam.audit.EVENTS) / над чем (entity_type + entity_id или entity_key
    для не-UUID сущностей: роль, право, вид выгрузки) / старое→новое / исход (success/failure/
    denied) / откуда (IP, User-Agent) / сквозной request_id — по нему находятся строки
    прикладного лога того же запроса.

    Append-only обеспечивается на уровне БД триггером (см. _AUDIT_APPEND_ONLY ниже и миграцию
    023): UPDATE/DELETE/TRUNCATE отвергаются даже для владельца таблицы — журнал нельзя
    «подчистить» из приложения, в том числе при компрометации его учётной записи БД.
    """
    __tablename__ = "audit_log"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True, index=True)
    username: Mapped[str | None] = mapped_column(String(100), nullable=True)
    action: Mapped[str | None] = mapped_column(String(50), nullable=True, index=True)
    outcome: Mapped[str | None] = mapped_column(String(16), nullable=True)
    entity_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    entity_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    entity_key: Mapped[str | None] = mapped_column(String(255), nullable=True)
    old_values: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    new_values: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    ip_address: Mapped[str | None] = mapped_column(INET, nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(512), nullable=True)
    request_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default="now()", nullable=False, index=True,
    )


# Append-only на уровне БД (ИБ-08). Тот же SQL выполняет миграция 023 на существующих базах;
# здесь — для баз, создаваемых create_all (тестовая БД), чтобы страж работал и в тестах.
AUDIT_APPEND_ONLY_SQL = (
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
for _stmt in AUDIT_APPEND_ONLY_SQL:
    event.listen(AuditLog.__table__, "after_create", DDL(_stmt).execute_if(dialect="postgresql"))


class RolePermission(Base):
    """Матрица доступа (BL-008 RBAC): наличие строки (role, permission) = право выдано.

    Каталог прав задаётся кодом (app.modules.iam.permissions); супер-администратор
    редактирует лишь связи роль→право. Резолвится permissions_service c кэшем в процессе.
    """
    __tablename__ = "role_permissions"
    __table_args__ = (UniqueConstraint("role", "permission", name="uq_role_permission"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    role: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    permission: Mapped[str] = mapped_column(String(100), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False,
    )


class MandatorySection(Base):
    """Обязательные разделы (ТЗ v20 п.10): наличие строки (permission) = раздел обязателен для
    ВСЕХ пользователей независимо от роли — нельзя скрыть в персональных настройках. Фиксируется
    только супер-администратором (admin.mandatory_sections.manage). Без роли — в отличие от
    RolePermission, здесь факт не «у роли есть право», а «раздел нельзя выключить никому»."""
    __tablename__ = "mandatory_sections"

    permission: Mapped[str] = mapped_column(String(100), primary_key=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False,
    )


class UserPreference(Base):
    """Персональные настройки интерфейса (BL-008, Фаза 4): состав и порядок виджетов дашбордов
    у конкретного пользователя. Одна строка на пользователя; `prefs` — свободный JSON вида
    {"dashboards": {"<key>": {"widgets": [{"id","enabled","order"}]}}}. Реестр виджетов на фронте
    задаёт дефолты, prefs их переопределяют."""
    __tablename__ = "user_preferences"

    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    prefs: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False,
    )
