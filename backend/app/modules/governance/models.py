"""
ORM-модель домена governance (T-10, код-ревью 2026-07-06): мера качества (Proposal).

Переносит governance-петлю из фронтового слоя (Redux+localStorage `asok_governance_v2`) в БД —
чтобы меры/решения/эскалации/контроль исполнения СИНХРОНИЗИРОВАЛИСЬ между ролями и устройствами
(бизнес-требование заказчика). Поля зеркалят фронтовый интерфейс `Proposal` (governanceSlice.ts);
история правок хранится в JSONB (список записей аудита), как на фронте.

SoD (ролевая модель v12 §5.1) обеспечивается в роутере через require_role, инварианты статусов —
в сервисе: создаёт меру менеджер по качеству, решение принимает топ-менеджмент, контроль исполнения
и эскалацию ведёт менеджер по качеству, решение по эскалации — топ-менеджмент.
"""
import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.infrastructure.database import Base
from app.shared.db import TimestampMixin

# Статусы меры (совпадают со строковыми литералами фронта — контракт не меняется).
STATUS_PENDING = "PENDING_APPROVAL"
STATUS_APPROVED = "APPROVED"
STATUS_REJECTED = "REJECTED"

EXECUTION_DONE = "DONE"
EXECUTION_NOT_DONE = "NOT_DONE"

ESCALATION_IGNORE = "IGNORE"
ESCALATION_REQUEST_MEASURES = "REQUEST_MEASURES"

# BL-007 (RE-11): тип меры — устраняющая (снимает первопричину, растёт Score, падает ALE) vs
# компенсирующая (первопричина остаётся, Score НЕ растёт, ALE падает за счёт ущерба/вероятности §4.2).
MEASURE_ELIMINATING = "ELIMINATING"
MEASURE_COMPENSATING = "COMPENSATING"
MEASURE_TYPES = (MEASURE_ELIMINATING, MEASURE_COMPENSATING)

# ТЗ v19 §17.6 (УК-55): источник формулировки меры — карточка, к которой прикасался LLM,
# несёт неубираемую метку (УК-55 критерий приёмки), отличимую от меры, введённой человеком.
MEASURE_SOURCE_MANUAL = "MANUAL"    # введена человеком
MEASURE_SOURCE_CATALOG = "CATALOG"  # переиспользован measure_catalog.py как есть
MEASURE_SOURCE_LLM = "LLM"          # LLM предложила новую формулировку (требует ревью, УК-56)
MEASURE_SOURCES = (MEASURE_SOURCE_MANUAL, MEASURE_SOURCE_CATALOG, MEASURE_SOURCE_LLM)

# Вердикт решения (RE-12/RE-13): три исхода, а не два (§3.1). Proposal остаётся совмещённой
# (мера + решение в одной сущности, решение заказчика) — вердикт живёт полем здесь.
VERDICT_ELIMINATE = "ELIMINATE"    # устранить — ROSI>0 или сработало вето
VERDICT_COMPENSATE = "COMPENSATE"  # компенсировать — ROSI<0, но риск выше аппетита
VERDICT_ACCEPT = "ACCEPT"          # принять — ROSI<0 и риск в пределах аппетита (с подписью, §3.3)
VERDICTS = (VERDICT_ELIMINATE, VERDICT_COMPENSATE, VERDICT_ACCEPT)


class Proposal(Base, TimestampMixin):
    """Мера качества / профессиональное суждение менеджера по качеству (governance-петля)."""
    __tablename__ = "proposals"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # --- Источник постановки (профсуждение) ---
    system_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    system_name: Mapped[str] = mapped_column(String(255), nullable=False)
    characteristic: Mapped[str | None] = mapped_column(String(255), nullable=True)
    metric_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    calculated_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    calculated_level: Mapped[str | None] = mapped_column(String(64), nullable=True)
    adjusted_level: Mapped[str | None] = mapped_column(String(64), nullable=True)
    rationale: Mapped[str | None] = mapped_column(Text, nullable=True)
    expectation: Mapped[str | None] = mapped_column(Text, nullable=True)
    create_risk: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    risk_title: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # --- Ответственный / срок ---
    owner: Mapped[str | None] = mapped_column(String(255), nullable=True)
    owner_role: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # ТЗ v19 УК-12: FK на users.id — строковый `owner` остаётся снимком отображаемого имени
    # (не удаляется, не становится обязательным полем прежде FK: часть строк ещё не сопоставлена,
    # см. backend/app/scripts/match_owners_to_users.py). Кросс-доменная ссылка — ForeignKey по
    # имени таблицы, без ORM relationship (правило модульного монолита, ARCHITECTURE.md).
    owner_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True, index=True,
    )
    due_date: Mapped[str | None] = mapped_column(String(32), nullable=True)  # legacy: ДД.ММ.ГГГГ, см. due_on
    # ТЗ v19 УК-36: даты как даты. due_date (строка) остаётся для обратной совместимости API,
    # due_on — источник истины для сортировки/сравнения/горизонтов (пункт 15).
    due_on: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # --- Решение топ-менеджмента (SoD) ---
    status: Mapped[str] = mapped_column(String(32), default=STATUS_PENDING, nullable=False, index=True)
    decided_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    decision_comment: Mapped[str | None] = mapped_column(Text, nullable=True)

    # --- Контроль исполнения (менеджер по качеству) ---
    execution: Mapped[str | None] = mapped_column(String(16), nullable=True)  # DONE/NOT_DONE
    execution_comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    executed_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    executed_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True, index=True,
    )
    executed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # ТЗ v19 УК-13/16: трудоёмкость в часах — проставляет исполнитель вручную при переводе
    # меры «в работу» (решение по В-41, docs/ТЗ_19). Отсутствие значения ≠ 0 — карточка мер
    # без оценки считается отдельно ("без оценки часов"), а не как нулевая нагрузка.
    effort_hours: Mapped[float | None] = mapped_column(Numeric(8, 2), nullable=True)
    effort_hours_set_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True,
    )
    effort_hours_set_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # ТЗ v19 УК-16 (п.16): переписывание меры на язык исполнителя (персона EXECUTOR) —
    # конкретные шаги вместо профсуждения (rationale) и вместо просьбы к ЛПР (expectation, п.14).
    # Запускает менеджер по качеству кнопкой «Переписать для исполнителя»; появляется на
    # карточке задачи в «Плане задач» (внутренний Гант) и на «Моих задачах» исполнителя.
    executor_brief: Mapped[str | None] = mapped_column(Text, nullable=True)
    executor_brief_generated_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True,
    )
    executor_brief_generated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # --- План задач / эскалация ---
    suz_link: Mapped[str | None] = mapped_column(String(512), nullable=True)
    top_comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    escalated: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    escalation_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    escalation_decision: Mapped[str | None] = mapped_column(String(32), nullable=True)
    escalation_decision_comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    escalation_decided_by: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # ── BL-007 (RE-11): экономический слой меры — входы и кэш для ROSI (§3.1) ──
    measure_type: Mapped[str | None] = mapped_column(String(16), nullable=True)  # ELIMINATING/COMPENSATING
    capex: Mapped[float | None] = mapped_column(Numeric(16, 2), nullable=True)          # разовые затраты
    opex_per_year: Mapped[float | None] = mapped_column(Numeric(16, 2), nullable=True)  # ежегодные затраты
    implementation_months: Mapped[float | None] = mapped_column(Numeric(6, 2), nullable=True)  # t_внедр (лаг)
    expected_delta_score: Mapped[float | None] = mapped_column(Numeric(6, 2), nullable=True)    # ΔScore
    # ΔALE раскладывается на три природы экономии (§2.4): кассовая / отложенная контрактная /
    # высвобожденная мощность. В ROSI по умолчанию входит только кассовая.
    delta_ale_cash: Mapped[float | None] = mapped_column(Numeric(16, 2), nullable=True)
    delta_ale_deferred: Mapped[float | None] = mapped_column(Numeric(16, 2), nullable=True)
    delta_ale_capacity: Mapped[float | None] = mapped_column(Numeric(16, 2), nullable=True)
    # Кэш расчёта движка (RE-12): ROSI и рекомендованный вердикт (устранить/компенсировать/принять).
    rosi: Mapped[float | None] = mapped_column(Numeric(10, 4), nullable=True)
    recommended_verdict: Mapped[str | None] = mapped_column(String(16), nullable=True)
    verdict: Mapped[str | None] = mapped_column(String(16), nullable=True)  # принятый вердикт (§3.1)

    # --- Аудит правок (список записей {at, by, field, from, to}) ---
    history: Mapped[list | None] = mapped_column(JSONB, nullable=True)

    # --- Демо-признак (в live-режиме демо-меры скрываются, как на фронте) ---
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    created_by: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # ══════════════ ТЗ v19 §17 (Пункт 17): карточка поручения, критичность, Ц_ОМ ══════════════

    # §17.2 (УК-42): обязательная привязка к risk_event — кроме процессных мер без риск-события
    # (напр. чисто организационная мера). Проверяется в service._ensure_routable, не здесь.
    is_process_measure: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # §17.2 (УК-44): Mission Critical под угрозой — переопределяет денежный порог, эскалация
    # всегда. Денормализовано с Nonconformity.is_blocking при связывании (nonconformity легитимно
    # зависит от governance, не наоборот — модульный монолит, ARCHITECTURE.md §B4), чтобы
    # governance не импортировал nonconformity.
    is_blocking_override: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # §17.4 (УК-49): Ц_ОМ — снимок на момент фиксации просрочки (неизменен задним числом) +
    # текущее значение, пересчитываемое ежедневно фоновой задачей (governance/tasks.py).
    ale_at_risk_snapshot: Mapped[float | None] = mapped_column(Numeric(16, 2), nullable=True)
    ale_at_risk_snapshot_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ale_at_risk_current: Mapped[float | None] = mapped_column(Numeric(16, 2), nullable=True)
    ale_at_risk_current_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # §17.3 (УК-46/48): состав карточки эскалации.
    # alternative_solutions: [{"title": str, "capex": float|None, "opex": float|None, "note": str}]
    alternative_solutions: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    systemic_scope_note: Mapped[str | None] = mapped_column(Text, nullable=True)         # ручной анализ
    systemic_scope_llm_note: Mapped[str | None] = mapped_column(Text, nullable=True)     # пометка LLM
    systemic_scope_system_count: Mapped[int | None] = mapped_column(Integer, nullable=True)  # детерминированно
    department: Mapped[str | None] = mapped_column(String(255), nullable=True)           # из measure_departments

    # §17.6 (УК-55/56): источник формулировки меры и обязательное ревью LLM-рекомендаций.
    measure_source: Mapped[str] = mapped_column(String(16), default=MEASURE_SOURCE_MANUAL, nullable=False)
    llm_reviewed_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True,
    )
    llm_reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # §17.7 (УК-57): факт по бюджету/трудоёмкости — рядом с уже существующим планом
    # (capex/opex_per_year/effort_hours). Вносит сам исполнитель по завершении меры (В решение
    # заказчика 7.1), не автоматически — интеграция с внешним источником фактических затрат
    # придёт позже без переделки полей. None ≠ 0 — «факт не внесён» отличается от «потрачено 0».
    actual_capex: Mapped[float | None] = mapped_column(Numeric(16, 2), nullable=True)
    actual_opex: Mapped[float | None] = mapped_column(Numeric(16, 2), nullable=True)
    actual_effort_hours: Mapped[float | None] = mapped_column(Numeric(8, 2), nullable=True)
    actuals_set_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True,
    )
    actuals_set_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class MeasureDepartment(Base, TimestampMixin):
    """Временный справочник направлений (§17.3, УК-47) — «характеристика → направление»,
    условное деление вручную до интеграции с AD (задел, не оргструктура сотрудников).
    Одна запись на характеристику (не подхарактеристику — «условное деление», решение
    заказчика §17.3): деление по подхарактеристикам добавить позже без переделки карточки,
    если понадобится более тонкая гранулярность."""
    __tablename__ = "measure_departments"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    characteristic: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    department_name: Mapped[str] = mapped_column(String(255), nullable=False)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True,
    )


class ProposalPriceSnapshot(Base, TimestampMixin):
    """Дневной снимок Ц_ОМ (§17.4, УК-49/51) — одна строка на (мера, календарный день).

    Отдельная таблица вместо перезаписи `Proposal.ale_at_risk_current` каждый день: реальная
    история нужна для честной квартальной агрегации (переключатель «день/квартал» на карточке)
    вместо двух статичных чисел (снимок на просрочку + текущее). Пишет ежедневная задача
    (governance/tasks.py) — идемпотентно, один UPDATE вместо нового INSERT при повторном
    прогоне за тот же день (см. record_daily_price_snapshot)."""
    __tablename__ = "proposal_price_snapshots"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    proposal_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("proposals.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    snapshot_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    price: Mapped[float] = mapped_column(Numeric(16, 2), nullable=False)

    __table_args__ = (
        UniqueConstraint("proposal_id", "snapshot_date", name="uq_proposal_price_snapshot_day"),
    )
