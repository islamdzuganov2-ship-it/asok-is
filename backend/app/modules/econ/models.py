"""
ORM-модели домена econ (BL-007, RE-01…RE-04): экономические справочники контура.

Домен несёт «фундамент денег»:
- E9 бизнес-процесс + связь ИС↔БП + стоимость минуты простоя `C_мин` (§2.5 ТЗ);
- E8 ставки сопровождения L1/L2/L3 как атрибут связки ИС×линия×исполнитель (§2.4 ТЗ);
- финпараметры контура (ставка дисконта, горизонт, α_min/N₀, пороги акцепта) как редактируемый конфиг.

Расчётные движки (`C_ТС`, `ALE`, `ROSI`) — отдельным слоем (economics.py) поверх этих справочников;
здесь только данные. Кросс-доменные связи — строковыми ForeignKey (правило зависимостей §B4).
"""
import uuid

from sqlalchemy import Boolean, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.infrastructure.database import Base
from app.shared.db import TimestampMixin

# --- Тип бизнес-процесса → метод расчёта стоимости минуты простоя по умолчанию (§2.5) ---
BP_BACKOFFICE = "BACKOFFICE"      # бэк-офис/внутренние → ресурсный метод
BP_FRONTAL = "FRONTAL"            # фронтальные/выручкообразующие → транзакционный
BP_BACKGROUND = "BACKGROUND"      # фоновые/интеграционные без штата → экспертно-ступенчатый
BP_KINDS = (BP_BACKOFFICE, BP_FRONTAL, BP_BACKGROUND)

# --- Метод расчёта C_мин ---
COST_METHOD_RESOURCE = "RESOURCE"           # ресурсный: N×ставка×K_простоя/60×K_наверстывания
COST_METHOD_TRANSACTIONAL = "TRANSACTIONAL" # транзакционный: выручка/маржа за период / минуты × доля
COST_METHOD_EXPERT = "EXPERT"               # экспертно-ступенчатый диапазон
COST_METHODS = (COST_METHOD_RESOURCE, COST_METHOD_TRANSACTIONAL, COST_METHOD_EXPERT)

# --- Линии сопровождения и тип исполнителя (§2.4) ---
LINES = ("L1", "L2", "L3")
EXECUTOR_INTERNAL = "INTERNAL"   # внутренняя команда (ФОТ+накладные)
EXECUTOR_VENDOR = "VENDOR"       # вендор по контракту
EXECUTOR_TYPES = (EXECUTOR_INTERNAL, EXECUTOR_VENDOR)


class BusinessProcess(Base, TimestampMixin):
    """Бизнес-процесс (E9). Стоимость простоя — атрибут БП, не ИС (§2.5)."""
    __tablename__ = "business_processes"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False, default=BP_BACKOFFICE)
    owner: Mapped[str | None] = mapped_column(String(255), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class SystemBusinessProcess(Base, TimestampMixin):
    """Связь ИС↔БП (M:N) с долей процесса, обслуживаемой данной ИС (для раскладки простоя)."""
    __tablename__ = "system_business_processes"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    system_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("systems.id"), nullable=False, index=True,
    )
    business_process_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("business_processes.id"), nullable=False, index=True,
    )
    # Доля процесса, обслуживаемая этой ИС (0..1) — множитель раскладки стоимости простоя.
    share: Mapped[float] = mapped_column(Numeric(5, 4), nullable=False, default=1)
    # K влияния по умолчанию: при частичном отказе один БП встаёт полностью, другой работает (§2.1).
    default_k_impact: Mapped[float | None] = mapped_column(Numeric(5, 4), nullable=True)

    __table_args__ = (
        UniqueConstraint("system_id", "business_process_id", name="uq_system_bp"),
    )


class BusinessProcessCost(Base, TimestampMixin):
    """Карточка стоимости минуты простоя БП `C_мин` (§2.5). Метод хранится ВМЕСТЕ с числом —
    первый вопрос CFO про метод, поэтому он не в голове аналитика."""
    __tablename__ = "business_process_costs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    business_process_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("business_processes.id"), nullable=False, index=True,
    )
    method: Mapped[str] = mapped_column(String(16), nullable=False, default=COST_METHOD_RESOURCE)
    # Метод-специфичные параметры: ресурсный {n_employees, hourly_rate, k_idle, k_catchup};
    # транзакционный {revenue_per_period, minutes_per_period, process_share}; экспертный {low, high}.
    params: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    # Временной профиль: множители C_мин по времени суток/дню недели (пик/непик, будни/выходные).
    time_profile: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    # Базовая (непиковая, будни) стоимость минуты, ₽ — вычислена движком или введена вручную.
    cost_per_min_base: Mapped[float | None] = mapped_column(Numeric(14, 4), nullable=True)
    currency: Mapped[str] = mapped_column(String(8), nullable=False, default="RUB")
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        UniqueConstraint("business_process_id", name="uq_bp_cost"),
    )


class SupportRate(Base, TimestampMixin):
    """Ставка сопровождения (E8) — атрибут связки ИС × линия × исполнитель (§2.4).

    system_id = NULL → ставка по умолчанию для линии/исполнителя (fallback, когда нет специфичной).
    Смешанная модель: часть линий внутренние, часть вендорские → единого поля «ставка L2» нет.
    """
    __tablename__ = "support_rates"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    system_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("systems.id"), nullable=True, index=True,
    )
    line: Mapped[str] = mapped_column(String(4), nullable=False, index=True)  # L1/L2/L3
    executor_type: Mapped[str] = mapped_column(String(16), nullable=False, default=EXECUTOR_INTERNAL)
    vendor: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Режим контракта: плановый/аварийный — ставка часто разная (§2.4).
    mode: Mapped[str | None] = mapped_column(String(16), nullable=True)

    rate_per_hour: Mapped[float] = mapped_column(Numeric(14, 2), nullable=False)
    k_evening: Mapped[float] = mapped_column(Numeric(5, 2), nullable=False, default=1.5)   # вечер/ночь
    k_weekend: Mapped[float] = mapped_column(Numeric(5, 2), nullable=False, default=2.0)   # выходные
    # Контрактные атрибуты (вендор): пакет часов, сверхлимитный тариф, минимальный биллинг-квант.
    package_hours: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    overlimit_rate: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)
    billing_quantum_min: Mapped[int] = mapped_column(Numeric(6, 0), nullable=False, default=60)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class EconConfig(Base, TimestampMixin):
    """Финпараметры контура (редактируются без деплоя): ставка дисконта `r`, горизонт `T`,
    α_min/N₀ (веса), пороги матрицы акцепта, порог катастрофичности и т. д. (§3, §4.3)."""
    __tablename__ = "econ_config"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)


# --- Классы размера предприятия (209-ФЗ, В-28) ---
SIZE_MICRO = "MICRO"
SIZE_SMALL = "SMALL"
SIZE_MEDIUM = "MEDIUM"
SIZE_LARGE = "LARGE"  # вне 209-ФЗ (закон определяет только МСП), но нужен как верхняя граница шкалы
SIZE_CLASSES = (SIZE_MICRO, SIZE_SMALL, SIZE_MEDIUM, SIZE_LARGE)

# Единственный допустимый id профиля — искусственный синглтон, а не мультиарендность (Р-4, В-4):
# «кого классифицируем по размеру» — саму установку, одна запись, без справочника организаций.
ENTERPRISE_PROFILE_ID = uuid.UUID("00000000-0000-0000-0000-00000000e9f1")


class EnterpriseProfile(Base, TimestampMixin):
    """Профиль предприятия (ТЗ v19 п.8, УК-21) — РОВНО одна запись на установку (id зафиксирован
    как `ENTERPRISE_PROFILE_ID`, сервис всегда работает с этой единственной строкой).

    Это НЕ справочник организаций и не мультиарендность: размер/отрасль/регион нужны как параметр
    подстановки для рыночных бенчмарков (п.9-10), а не как измерение для сегментации данных.
    Решение зафиксировано с заказчиком 15.08.2026, см. docs/ТЗ_19_Управленческий_Контур_и_Веса.md §0 Р-4.
    """
    __tablename__ = "enterprise_profile"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Критерий — 209-ФЗ (В-28, предложено заказчику, ждёт подтверждения): микро/малое/среднее/крупное.
    size_class: Mapped[str | None] = mapped_column(String(16), nullable=True)
    revenue_annual: Mapped[float | None] = mapped_column(Numeric(18, 2), nullable=True)
    headcount: Mapped[int | None] = mapped_column(Integer, nullable=True)
    industry: Mapped[str | None] = mapped_column(String(255), nullable=True)
    region: Mapped[str | None] = mapped_column(String(255), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True,
    )
