"""
Pydantic-схемы домена governance (T-10). camelCase-алиасы — чтобы фронтовый контракт `Proposal`
(governanceSlice.ts) не менялся при переходе с localStorage на API.

Поля-подписи (`decidedBy`, `executedBy`, `createdBy`, `escalationDecidedBy`) на входе НЕ
принимаются — они проставляются на сервере из токена (нельзя подделать «кто решил/выполнил»).
"""
from __future__ import annotations

import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class _CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)


class ProposalChange(_CamelModel):
    at: str
    by: str
    field: str
    from_: str | None = None
    to: str | None = None
    model_config = ConfigDict(
        alias_generator=to_camel, populate_by_name=True, from_attributes=True,
        # поле называется from_ (from — ключевое слово), но наружу/внутрь — «from»
    )


class ProposalOut(_CamelModel):
    id: uuid.UUID
    system_id: uuid.UUID | None = None
    system_name: str
    characteristic: str | None = None
    metric_name: str | None = None
    calculated_score: float | None = None
    calculated_level: str | None = None
    adjusted_level: str | None = None
    rationale: str | None = None
    expectation: str | None = None
    create_risk: bool = False
    risk_title: str | None = None
    owner: str | None = None
    owner_role: str | None = None
    # ТЗ v19 УК-12: FK на пользователя рядом со строкой-снимком имени (owner). None, пока
    # не сопоставлено скриптом match_owners_to_users.py — это НЕ ошибка, а честное «пока строка».
    owner_user_id: uuid.UUID | None = None
    due_date: str | None = None
    # ТЗ v19 УК-36: due_on — источник истины для сортировки/сравнения (пункт 11-12, 15).
    # due_date остаётся для обратной совместимости фронта, не вычисляется из due_on обратно.
    due_on: datetime | None = None
    status: str
    decided_by: str | None = None
    decided_at: datetime | None = None
    decision_comment: str | None = None
    execution: str | None = None
    execution_comment: str | None = None
    executed_by: str | None = None
    executed_by_user_id: uuid.UUID | None = None
    executed_at: datetime | None = None
    # ТЗ v19 УК-13 (п.13, В-41): трудоёмкость в часах, проставляет исполнитель вручную при
    # переводе меры «в работу». None ≠ 0 — считается отдельно как «без оценки часов».
    effort_hours: float | None = None
    effort_hours_set_by: uuid.UUID | None = None
    effort_hours_set_at: datetime | None = None
    # ТЗ v19 п.16: мера, переписанная на язык исполнителя (персона EXECUTOR).
    executor_brief: str | None = None
    executor_brief_generated_by: uuid.UUID | None = None
    executor_brief_generated_at: datetime | None = None
    suz_link: str | None = None
    top_comment: str | None = None
    escalated: bool = False
    escalation_reason: str | None = None
    escalation_decision: str | None = None
    escalation_decision_comment: str | None = None
    escalation_decided_by: str | None = None
    # BL-007 (RE-11/12): экономический слой меры.
    measure_type: str | None = None
    capex: float | None = None
    opex_per_year: float | None = None
    implementation_months: float | None = None
    expected_delta_score: float | None = None
    delta_ale_cash: float | None = None
    delta_ale_deferred: float | None = None
    delta_ale_capacity: float | None = None
    rosi: float | None = None
    recommended_verdict: str | None = None
    verdict: str | None = None
    history: list | None = None
    is_demo: bool = False
    created_by: str | None = None
    created_at: datetime | None = None

    # ── ТЗ v19 §17: карточка поручения, критичность, Ц_ОМ ──
    is_process_measure: bool = False
    is_blocking_override: bool = False
    ale_at_risk_snapshot: float | None = None
    ale_at_risk_snapshot_at: datetime | None = None
    ale_at_risk_current: float | None = None
    ale_at_risk_current_at: datetime | None = None
    alternative_solutions: list | None = None
    systemic_scope_note: str | None = None
    systemic_scope_llm_note: str | None = None
    systemic_scope_system_count: int | None = None
    department: str | None = None
    measure_source: str = "MANUAL"
    llm_reviewed_by: uuid.UUID | None = None
    llm_reviewed_at: datetime | None = None

    # §17.5 (УК-52/53): транзиентные поля очереди — считаются только при order_by=priority
    # (list_proposals), не хранятся в БД. None вне режима приоритета, а не 0 молча.
    priority_weight: float | None = None
    priority_money: float | None = None
    priority_is_atypical: bool | None = None

    # §17.7 (УК-57): факт по бюджету/трудоёмкости — рядом с уже существующим планом.
    actual_capex: float | None = None
    actual_opex: float | None = None
    actual_effort_hours: float | None = None
    actuals_set_by: uuid.UUID | None = None
    actuals_set_at: datetime | None = None


class AlternativeSolutionIn(_CamelModel):
    title: str
    capex: float | None = None
    opex: float | None = None
    note: str | None = None


class AlternativesIn(_CamelModel):
    alternatives: list[AlternativeSolutionIn]


class SystemicScopeIn(_CamelModel):
    """Ручной анализ системности (§17.3, УК-46) — если задан, LLM-пометка дополняет его,
    но никогда не перезаписывает (см. governance/systemic_scope.py)."""
    note: str


class PriceOfInactionOut(_CamelModel):
    """Ц_ОМ на карточке (§17.4) — снимок на момент просрочки + текущее значение, разная
    формула для ELIMINATING/COMPENSATING (УК-49/50)."""
    proposal_id: uuid.UUID
    measure_type: str | None = None
    is_overdue: bool
    ale_risk: float                       # деньги под риском по связанным risk_event (§17.2)
    price_snapshot: float | None = None   # Ц_ОМ на момент фиксации просрочки
    price_snapshot_at: datetime | None = None
    price_current: float | None = None    # Ц_ОМ на сегодня (пересчитывается ежедневно)
    price_current_at: datetime | None = None


class PriceHistoryPointOut(_CamelModel):
    """Одна дневная точка Ц_ОМ (§17.4, УК-51)."""
    date: date
    price: float


class PriceHistoryOut(_CamelModel):
    """История Ц_ОМ за период — честная квартальная агрегация вместо переиспользования
    снимка/текущего значения под другой подписью (§17.4, УК-51)."""
    proposal_id: uuid.UUID
    period: str  # 'day' | 'quarter'
    period_start: date
    period_end: date
    points: list[PriceHistoryPointOut]
    period_avg: float | None = None


# ── ТЗ v19 п.15 (УК-37): эффект меры во времени ──
class QuarterEffectPointOut(_CamelModel):
    quarter_label: str
    quarter_start: date
    net_cash: float
    cumulative: float


class EffectTimelineOut(_CamelModel):
    """Горизонт эффекта меры по кварталам — самодостаточен для карточки (пункт 15: «ни один
    эффект без периода»)."""
    proposal_id: uuid.UUID
    computable: bool
    reason: str | None = None
    start_date: date | None = None
    effect_start_date: date | None = None
    capex: float = 0.0
    points: list[QuarterEffectPointOut] = []
    payback_quarter: str | None = None


class QuarterPortfolioPointOut(_CamelModel):
    quarter_label: str
    net_cash: float
    cumulative: float


class PortfolioEffectCurveOut(_CamelModel):
    """Портфельно: «когда придут деньги» — Σ квартальных эффектов по всем одобренным мерам
    с определённой датой старта (УК-37)."""
    points: list[QuarterPortfolioPointOut]
    measures_included: int
    measures_excluded_no_start_date: int


class ActualsIn(_CamelModel):
    """Факт по бюджету/трудоёмкости меры (§17.7, УК-57) — исполнитель вносит по завершении.
    Хотя бы одно поле обязательно (проверяется в сервисе) — пустой вызов бессмыслен."""
    actual_capex: float | None = None
    actual_opex: float | None = None
    actual_effort_hours: float | None = None


class BudgetVarianceOut(_CamelModel):
    """План/факт по мере (§17.7) — variance = факт − план, None, если одной из сторон нет
    (а не 0 молча: «не оценено» ≠ «отклонения нет»)."""
    proposal_id: uuid.UUID
    planned_capex: float | None = None
    actual_capex: float | None = None
    capex_variance: float | None = None
    planned_opex: float | None = None
    actual_opex: float | None = None
    opex_variance: float | None = None
    planned_effort_hours: float | None = None
    actual_effort_hours: float | None = None
    effort_variance: float | None = None


class MeasureDepartmentOut(_CamelModel):
    id: uuid.UUID
    characteristic: str
    department_name: str
    updated_by: uuid.UUID | None = None


class MeasureDepartmentIn(_CamelModel):
    characteristic: str
    department_name: str


class LlmReviewIn(_CamelModel):
    """Обязательное ревью LLM-рекомендации перед эскалацией (§17.6, УК-56)."""
    approved: bool
    comment: str | None = None


# ── BL-007 (RE-11/12): экономические входы меры и результат расчёта ROSI ──
class MeasureEconomicsIn(_CamelModel):
    measure_type: str | None = None            # ELIMINATING / COMPENSATING
    capex: float | None = None
    opex_per_year: float | None = None
    implementation_months: float | None = None
    expected_delta_score: float | None = None
    # Ручной ввод ΔALE (кассовая часть). Если не задан — считается по привязанным рискам.
    delta_ale_cash: float | None = None
    delta_ale_deferred: float | None = None
    delta_ale_capacity: float | None = None
    verdict: str | None = None                  # принятый вердикт (утверждает ЛПР)


class MeasureEconomicsResult(_CamelModel):
    proposal_id: uuid.UUID
    risks_count: int
    delta_ale_per_year: float
    rosi: float | None = None
    benefit_pv: float | None = None
    cost_pv: float | None = None
    recommended_verdict: str
    reasons: list[str]


class ProposalCreate(_CamelModel):
    system_name: str
    characteristic: str | None = None
    metric_name: str | None = None
    calculated_score: float | None = None
    calculated_level: str | None = None
    adjusted_level: str | None = None
    rationale: str | None = None
    expectation: str | None = None
    create_risk: bool = False
    risk_title: str | None = None
    owner: str | None = None
    owner_role: str | None = None
    due_date: str | None = None
    is_demo: bool = False
    # §17.2 (УК-42): мера без риск-события по умолчанию не эскалируема/не одобряема, пока не
    # привязана к risk_event — кроме явно помеченных процессных мер (см. service._ensure_routable).
    is_process_measure: bool = False


class DecisionIn(_CamelModel):
    comment: str | None = None


class MetaIn(_CamelModel):
    owner: str | None = None
    owner_role: str | None = None
    due_date: str | None = None


class EditIn(_CamelModel):
    """Правка меры топ-менеджментом — поля пишутся в историю (аудит)."""
    risk_title: str | None = None
    rationale: str | None = None
    expectation: str | None = None
    owner: str | None = None
    owner_role: str | None = None
    due_date: str | None = None
    top_comment: str | None = None


class ExecutionIn(_CamelModel):
    status: str  # DONE / NOT_DONE
    comment: str


class EffortHoursIn(_CamelModel):
    """ТЗ v19 п.13 (В-41): трудоёмкость проставляет исполнитель вручную в часах."""
    effort_hours: float


class TaskUpdateIn(_CamelModel):
    suz_link: str | None = None
    top_comment: str | None = None
    owner: str | None = None
    owner_role: str | None = None
    due_date: str | None = None


class EscalateIn(_CamelModel):
    reason: str


class EscalationDecisionIn(_CamelModel):
    decision: str  # IGNORE / REQUEST_MEASURES
    comment: str
