"""
ORM-модель домена nonconformity (BL-007, RE-14): несоответствие подхарактеристики (E3).

Это ХРЕБЕТ замыкания контура (§0, §3.3 ТЗ). Задача 6 списка заказчика — не задача, а принцип:
без обязательного шага «Решение → Мера → Верификация» с владельцем, датой и подписью система
остаётся «аудитом ради аудита». Поэтому статус несоответствия НЕ может остановиться на «Выявлено»:
жизненный цикл фиксирован, владелец обязателен, «Верифицировано» ставит независимый аудитор (SoD).

Решение заказчика: отдельная сущность (не расширение defect_matrices) — у несоответствия свой
жизненный цикл, владелец, SLA и связи (риск, мера). Кросс-доменные ссылки — строковыми ForeignKey.
"""
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Numeric, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.infrastructure.database import Base
from app.shared.db import TimestampMixin

# ── Жизненный цикл несоответствия — статусы ОБЯЗАТЕЛЬНЫ к прохождению (§3.3) ──
STATUS_IDENTIFIED = "IDENTIFIED"              # Выявлено
STATUS_EVALUATED = "EVALUATED"                # Оценено (₽) — посчитан ALE
STATUS_DECIDED = "DECIDED"                    # Решение принято (устранить/компенсировать/принять)
STATUS_MEASURE_ASSIGNED = "MEASURE_ASSIGNED"  # Мера назначена
STATUS_IN_PROGRESS = "IN_PROGRESS"            # В работе
STATUS_EXECUTED = "EXECUTED"                  # Исполнено (ставит исполнитель)
STATUS_VERIFIED = "VERIFIED"                  # Верифицировано (ставит ТОЛЬКО аудитор, §3.3)
# Порядок статусов = порядок воронки замкнутости контура (дашборд §5, виджет 6).
STATUS_FLOW = (
    STATUS_IDENTIFIED, STATUS_EVALUATED, STATUS_DECIDED, STATUS_MEASURE_ASSIGNED,
    STATUS_IN_PROGRESS, STATUS_EXECUTED, STATUS_VERIFIED,
)

# ── Уровень несоответствия — единая шкала для всех подхарактеристик (§4.1) ──
LEVEL_MINOR = "MINOR"        # незначительное (в пределах допуска деградации) — 75% вклада
LEVEL_MAJOR = "MAJOR"        # существенное (норматив нарушен, БП работает) — 40%
LEVEL_CRITICAL = "CRITICAL"  # критическое (норматив нарушен, БП под угрозой) — 0% + флаг блокирующего
LEVELS = (LEVEL_MINOR, LEVEL_MAJOR, LEVEL_CRITICAL)

# ── Тип доказательной базы (§4.1, RE-21) — от него зависит доверие и автоматизация ──
EVIDENCE_A = "A"  # инструментальное измерение (APM/мониторинг/нагрузочное) — доверие высокое
EVIDENCE_B = "B"  # инцидентная статистика (ITSM) — высокое
EVIDENCE_C = "C"  # анализ артефактов кода (SAST/DAST/покрытие) — среднее-высокое
EVIDENCE_D = "D"  # документальная проверка — среднее
EVIDENCE_E = "E"  # экспертная оценка (интервью/чек-лист) — низкое-среднее
EVIDENCE_TYPES = (EVIDENCE_A, EVIDENCE_B, EVIDENCE_C, EVIDENCE_D, EVIDENCE_E)


class Nonconformity(Base, TimestampMixin):
    """Несоответствие подхарактеристики (E3) с обязательным жизненным циклом до «Верифицировано»."""
    __tablename__ = "nonconformities"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code: Mapped[str | None] = mapped_column(String(50), unique=True, nullable=True, index=True)

    # --- Что и где (E1×E2) ---
    system_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True, index=True)
    system_name: Mapped[str] = mapped_column(String(255), nullable=False)
    characteristic: Mapped[str] = mapped_column(String(255), nullable=False)
    subcharacteristic: Mapped[str] = mapped_column(String(255), nullable=False)
    # Значение оценки, породившее несоответствие (мост к контуру оценки).
    assessment_value_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)

    # --- Доказательство и тяжесть (§4.1) ---
    evidence_type: Mapped[str | None] = mapped_column(String(4), nullable=True)  # A/B/C/D/E
    level: Mapped[str] = mapped_column(String(16), nullable=False, default=LEVEL_MAJOR)
    # Критическое на Mission Critical не усредняется весами — отдельный блок в отчёт (§4.1).
    is_blocking: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # --- Владелец и статус (§3.3) ---
    status: Mapped[str] = mapped_column(String(24), nullable=False, default=STATUS_IDENTIFIED, index=True)
    # Обязательный владелец: несоответствие без владельца не сохраняется (проверяет сервис).
    owner: Mapped[str] = mapped_column(String(255), nullable=False)
    # ТЗ v19 УК-12: FK на users.id, необязательный до полного сопоставления строковых `owner`
    # (backend/app/scripts/match_owners_to_users.py). Строка остаётся источником отображаемого
    # имени — так исторические записи не ломаются, пока не сопоставлены.
    owner_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True, index=True,
    )

    # --- Оценка (₽) и связи с контуром ---
    evaluated_ale: Mapped[float | None] = mapped_column(Numeric(16, 2), nullable=True)
    risk_event_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("risk_events.id"), nullable=True, index=True,
    )
    proposal_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("proposals.id"), nullable=True, index=True,
    )

    # --- Решение и акцепт (§3.3, матрица акцепта по сумме ALE) ---
    decision_verdict: Mapped[str | None] = mapped_column(String(16), nullable=True)  # ELIMINATE/COMPENSATE/ACCEPT
    acceptance_level: Mapped[str | None] = mapped_column(String(32), nullable=True)  # владелец ИС/CIO/правление
    signed_by: Mapped[str | None] = mapped_column(String(255), nullable=True)        # подписант принятия риска
    # SLA на решение: >30 дней в «Оценено» без решения → автоэскалация (сервис/воркер).
    sla_due: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Принятый риск обязан иметь дату переоценки (по умолчанию 6 мес).
    review_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # --- Исполнение и НЕЗАВИСИМАЯ верификация (SoD §3.3) ---
    executed_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    executed_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True, index=True,
    )
    executed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    verified_by: Mapped[str | None] = mapped_column(String(255), nullable=True)   # только роль AUDITOR
    verified_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True, index=True,
    )
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Подтверждённый при верификации ΔScore — вход метрики результативности руководителей (§7.1).
    delta_score_confirmed: Mapped[float | None] = mapped_column(Numeric(6, 2), nullable=True)

    # --- Аудит правок (список записей {at, by, field, from, to}), как в governance ---
    history: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    is_demo: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_by: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # ТЗ v19 §17.9 (УК-59/60): автоэскалация по SLA — дифференцирована по level (тот же критерий,
    # что маршрутизация мер §17.2, В-64). Флаг защищает от повторной нотификации каждый прогон
    # ежедневной задачи (nonconformity/tasks.py) — эскалируем один раз, не спамим.
    sla_escalated: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    sla_escalated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
