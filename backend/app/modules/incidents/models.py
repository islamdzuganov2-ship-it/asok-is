"""
ORM-модель домена incidents (T-21, код-ревью 2026-07-06): технический сбой ИС (TechIncident).

Новое бизнес-направление — «аналитика технических сбоев»: отдельный анализатор надёжности как
дополнительный источник фактов для менеджера по качеству, топ-менеджмента (по флагу) и LLM.
Самостоятельный реестр — НЕ вмешивается в расчётный движок оценки качества (решение заказчика);
связь с ISO 25010 «Надёжность» — только на уровне аналитики и подсказок (маппинг в коде).

Классификация по первопричине (заказчик): привнесено релизом, инфраструктура, производительность,
сеть, электроснабжение. Набор расширяемый (строковые коды + валидация в схеме).
"""
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Numeric, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.infrastructure.database import Base
from app.shared.db import TimestampMixin

# Категории первопричины сбоя (расширяемый набор). Значения — стабильные коды для БД/фронта.
CATEGORY_RELEASE = "RELEASE"                # привнесено релизом (регрессия после развёртывания)
CATEGORY_INFRASTRUCTURE = "INFRASTRUCTURE"  # инфраструктура (серверы, СХД, ВМ, БД)
CATEGORY_PERFORMANCE = "PERFORMANCE"        # производительность (деградация, нехватка ресурсов)
CATEGORY_NETWORK = "NETWORK"                # сеть (связность, каналы, DNS, балансировка)
CATEGORY_POWER = "POWER"                    # электроснабжение (питание ЦОД, ИБП)
CATEGORY_OTHER = "OTHER"                    # пользовательская первопричина (текст — в category_custom, T-37)

CATEGORIES = (
    CATEGORY_RELEASE, CATEGORY_INFRASTRUCTURE, CATEGORY_PERFORMANCE,
    CATEGORY_NETWORK, CATEGORY_POWER, CATEGORY_OTHER,
)

# Маппинг первопричины сбоя → характеристика качества ISO 25010 (для риск-триггеров T-16):
# частые сбои категории проактивно «подсвечивают» риски по связанной характеристике.
CATEGORY_TO_CHARACTERISTIC: dict[str, str] = {
    CATEGORY_RELEASE: "Сопровождаемость",       # регрессии после релиза — тестируемость/сопровождаемость
    CATEGORY_INFRASTRUCTURE: "Надёжность",       # отказы инфраструктуры — зрелость/доступность
    CATEGORY_PERFORMANCE: "Производительность",   # деградация — время отклика/ресурсы/ёмкость
    CATEGORY_NETWORK: "Надёжность",              # сетевые сбои — доступность
    CATEGORY_POWER: "Надёжность",               # электроснабжение — отказоустойчивость
    CATEGORY_OTHER: "Надёжность",               # пользовательская — по умолчанию к надёжности
}

# Русские метки категорий (для сообщений backend, напр. пояснение риск-триггера).
CATEGORY_LABELS: dict[str, str] = {
    CATEGORY_RELEASE: "релиз",
    CATEGORY_INFRASTRUCTURE: "инфраструктура",
    CATEGORY_PERFORMANCE: "производительность",
    CATEGORY_NETWORK: "сеть",
    CATEGORY_POWER: "электроснабжение",
    CATEGORY_OTHER: "другое",
}

# Критичность сбоя — та же шкала, что у базы рисков (консистентность).
SEVERITIES = ("critical", "high", "medium", "low")

# Происхождение записи: ручной ввод (MVP), импорт, авто-приём из ITSM (задел, порт IncidentSource).
SOURCES = ("manual", "import", "itsm")

# BL-007 (RE-05, задача 17): тип события — полный простой vs деградация (частичная недоступность).
INCIDENT_DOWNTIME = "DOWNTIME"        # полный отказ (недоступность БП)
INCIDENT_DEGRADATION = "DEGRADATION"  # деградация: часть функций/производительности/пропускной
INCIDENT_TYPES = (INCIDENT_DOWNTIME, INCIDENT_DEGRADATION)

# Тип деградации → способ расчёта K влияния ∈ [0,1] (§2.2).
DEGRADATION_FUNCTIONAL = "FUNCTIONAL"       # часть функций недоступна
DEGRADATION_PERFORMANCE = "PERFORMANCE"     # выросло время отклика (ступенчатая шкала)
DEGRADATION_THROUGHPUT = "THROUGHPUT"       # обрабатывается не вся нагрузка
DEGRADATION_TYPES = (DEGRADATION_FUNCTIONAL, DEGRADATION_PERFORMANCE, DEGRADATION_THROUGHPUT)


class TechIncident(Base, TimestampMixin):
    """Технический сбой ИС — запись реестра надёжности (домен incidents)."""
    __tablename__ = "tech_incidents"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    system_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    system_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)

    category: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    severity: Mapped[str] = mapped_column(String(16), nullable=False, default="medium")

    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    root_cause: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Ссылка на релиз/версию — для сбоев категории RELEASE (регрессия после развёртывания).
    release_ref: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # T-36: обязательные (для ручного ввода source=manual) поля разбора сбоя. Nullable в БД —
    # обязательность проверяет сервис (для manual), т.к. импорт/ITSM могут быть неполны.
    admission_cause: Mapped[str | None] = mapped_column(Text, nullable=True)          # причина допущения
    responsible_unit: Mapped[str | None] = mapped_column(String(255), nullable=True)  # виновное направление производства
    preventive_measures: Mapped[str | None] = mapped_column(Text, nullable=True)      # меры по неповторению
    # T-37: пользовательская первопричина, если category == OTHER.
    category_custom: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # T-42: связь с мерой по улучшению качества (governance Proposal). Свободная ссылка (без FK —
    # реестр мер может быть в отдельном хранилище/демо); опциональна (мера может появиться позже).
    linked_measure_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)

    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    # Пока NULL — сбой открыт (не восстановлен). Заполнено → закрыт, для расчёта MTTR.
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # ── BL-007 (RE-05): экономический слой техсбоя — входы для C_ТС и ALE ──
    # Тип события и деградация (задача 17): DOWNTIME/DEGRADATION + подтип деградации.
    incident_type: Mapped[str] = mapped_column(String(16), nullable=False, default=INCIDENT_DOWNTIME)
    degradation_type: Mapped[str | None] = mapped_column(String(16), nullable=True)
    # Длительность недоступности (мин) и коэффициент влияния K∈[0,1] (для деградации <1) → C_простой.
    downtime_minutes: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    k_impact: Mapped[float | None] = mapped_column(Numeric(5, 4), nullable=True)
    # Тайминги (RE-05): T реакции, T устранения (до восстановления сервиса), T целевого решения.
    t_reaction_min: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    t_resolution_min: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    t_target_min: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    # Момент устранения ПЕРВОПРИЧИНЫ (не симптома) — разрыв с resolved_at = метрика зрелости (§2.1).
    root_cause_fixed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Трудозатраты по линиям (ч) — раздельно для C_восстановление = Σ T_линия×R_линия×K_время (§2.1).
    labor_l1_hours: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    labor_l2_hours: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    labor_l3_hours: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    # Признак участия вендора в устранении (для разреза по вендорам, §2.4).
    vendor_involved: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Кэш стоимости единичной реализации C_ТС (движок RE-07). NULL — ещё не считалось.
    cost_total: Mapped[float | None] = mapped_column(Numeric(16, 2), nullable=True)
    # Разложение C_ТС (RE-07): {recovery, downtime, secondary, lines:[...]} — чтобы на карточке было
    # видно, из чего сложилась цифра, и чтобы C_деградации считался отдельно от простоев (RE-06).
    cost_breakdown: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    # ── RE-06: деградация — входы расчёта K по типу и правило «деградация → простой» ──
    # FUNCTIONAL {unavailable_weight, total_weight}; PERFORMANCE {response_ratio};
    # THROUGHPUT {actual, required}. Пусто — K вводится экспертно вручную (k_impact).
    degradation_inputs: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    # Итог правила конвертации (K ≥ порога дольше N минут → учитывается как простой для SLA и
    # отчётности). NULL — не оценивалось (старые записи): аналитика считает по дефолтным порогам.
    counts_as_downtime: Mapped[bool | None] = mapped_column(Boolean, nullable=True)

    # ── RE-03/RE-05: линии, закрытые вендором (остальные — внутренней командой): ставка берётся
    # по связке ИС × линия × исполнитель, у вендора — пакет часов, сверхлимит и квант биллинга.
    labor_vendor_lines: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    # RE-24: откуда трудозатраты — ввод аналитика или восстановлены из журнала переназначений ITSM.
    labor_source: Mapped[str | None] = mapped_column(String(24), nullable=True)

    # ── RE-23/RE-26: автовыгрузка ITSM — внешний номер тикета и корреляция дублей ──
    external_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    # Дочерний тикет того же сбоя (без родительского тикета в ITSM, Пробел C): ссылка на «главный».
    # Дочерние не участвуют в ARO/доступности повторно — один сбой, а не N.
    parent_incident_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True, index=True)

    source: Mapped[str] = mapped_column(String(16), nullable=False, default="manual")
    created_by: Mapped[str | None] = mapped_column(String(255), nullable=True)


class ItsmGroupMapping(Base, TimestampMixin):
    """RE-25 (Пробел A): группа назначения ITSM → ИС. В ITSM тикет часто несёт только группу
    сопровождения, а не систему — без справочника сбой не привязать к ИС и он выпадает из ALE."""
    __tablename__ = "itsm_group_mappings"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    group_name: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    system_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("systems.id"), nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)


class SystemAlias(Base, TimestampMixin):
    """RE-25: алиас ИС — как система называется в ITSM/APM/переписке («АБС», «ЦФТ-Банк»,
    «core-banking»). Сравнение без регистра и лишних пробелов (нормализация в itsm.normalize_name)."""
    __tablename__ = "system_aliases"
    __table_args__ = (UniqueConstraint("alias_norm", name="uq_system_alias_norm"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    alias: Mapped[str] = mapped_column(String(255), nullable=False)
    alias_norm: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    system_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("systems.id"), nullable=False)
