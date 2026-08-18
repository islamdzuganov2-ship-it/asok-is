"""
REST API домена governance (T-10) — /api/v1/governance/proposals.

Переносит governance-петлю с фронта (localStorage) в БД. SoD по ролевой модели v12 §5.1:
  • создаёт меру и ведёт исполнение/эскалацию — менеджер по качеству;
  • решение по мере и по эскалации, правки/смена ответственного — топ-менеджмент.
Инварианты состояния (когда действие допустимо) — в service; здесь — кто (require_role).
Доменные исключения (NotFound/Conflict/Validation) маппятся на HTTP обработчиком в main.py.
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.database import get_db
from app.modules.governance import economics_service, management_summary, service
from app.modules.governance.schemas import (
    ActualsIn,
    AlternativesIn,
    BudgetVarianceOut,
    DecisionIn,
    EditIn,
    EffectTimelineOut,
    EffortHoursIn,
    EscalateIn,
    EscalationDecisionIn,
    ExecutionIn,
    LlmReviewIn,
    MeasureDepartmentIn,
    MeasureDepartmentOut,
    MeasureEconomicsIn,
    MeasureEconomicsResult,
    MetaIn,
    PortfolioEffectCurveOut,
    PriceHistoryOut,
    PriceOfInactionOut,
    ProposalCreate,
    ProposalOut,
    SystemicScopeIn,
    TaskUpdateIn,
)
from app.modules.iam import get_current_user, get_role_permissions, require_permission, resolve_user_id

router = APIRouter()

# SoD-уровни доступа (ролевая модель v12). ADMIN совмещает администрирование и решения.
DECISION_ROLES = ("ADMIN", "CTO", "CEO", "CIO", "EXECUTIVE")  # топ-менеджмент
MANAGER_ROLES = ("QUALITY_MANAGER", "ADMIN")                  # менеджер по качеству (+ADMIN супер)
ECONOMICS_ROLES = ("QUALITY_MANAGER", "RISK_MANAGER", "ADMIN")  # ввод/расчёт экономики меры (BL-007)


def _username(user: dict) -> str:
    return user.get("username") or "—"


@router.get("/proposals", response_model=list[ProposalOut])
async def list_proposals(
    system: str | None = None,
    status: str | None = None,
    include_demo: bool = True,
    order_by: str = "priority",
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(get_current_user),
) -> list:
    """order_by=priority (по умолчанию, §17.5, УК-52) — вес характеристики × деньги под риском,
    ×2 при просрочке. order_by=created_at — прежнее поведение (создано→новее сверху)."""
    return await service.list_proposals(
        db, system=system, status=status, include_demo=include_demo, order_by=order_by,
    )


@router.post("/proposals", response_model=ProposalOut, status_code=201)
async def create_proposal(
    payload: ProposalCreate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_permission("governance.propose")),
):
    return await service.create(db, payload, _username(user))


# ТЗ v19 п.15 (УК-37): портфельная кривая эффекта — литеральный путь ДО /proposals/{pid}/...,
# иначе FastAPI попытается разобрать «effect-curve» как UUID (порядок регистрации маршрутов
# имеет значение для литеральных путей против path-параметров, см. risk/event_router.py /by-cell).
@router.get("/proposals/effect-curve", response_model=PortfolioEffectCurveOut)
async def get_portfolio_effect_curve(
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("view.risk_economics")),
):
    return await economics_service.portfolio_effect_curve(db)


@router.post("/proposals/{pid}/approve", response_model=ProposalOut)
async def approve_proposal(
    pid: uuid.UUID, payload: DecisionIn | None = None,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_permission("governance.decide", "governance.decide.minor")),
):
    """§17.1/17.2: полное право решает любую меру; «минорное» — только ниже порога маршрутизации
    (проверяется в service.decide через can_self_decide)."""
    p = await service.get_or_404(db, pid)
    return await service.decide(db, p, True, (payload.comment if payload else None), _username(user), user=user)


@router.post("/proposals/{pid}/reject", response_model=ProposalOut)
async def reject_proposal(
    pid: uuid.UUID, payload: DecisionIn | None = None,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_permission("governance.decide", "governance.decide.minor")),
):
    p = await service.get_or_404(db, pid)
    return await service.decide(db, p, False, (payload.comment if payload else None), _username(user), user=user)


@router.patch("/proposals/{pid}/meta", response_model=ProposalOut)
async def update_meta(
    pid: uuid.UUID, payload: MetaIn,
    db: AsyncSession = Depends(get_db), user: dict = Depends(require_permission("governance.decide")),
):
    p = await service.get_or_404(db, pid)
    return await service.update_meta(db, p, payload, _username(user))


@router.patch("/proposals/{pid}", response_model=ProposalOut)
async def edit_proposal(
    pid: uuid.UUID, payload: EditIn,
    db: AsyncSession = Depends(get_db), user: dict = Depends(require_permission("governance.decide")),
):
    p = await service.get_or_404(db, pid)
    return await service.edit(db, p, payload, _username(user))


@router.post("/proposals/{pid}/execution", response_model=ProposalOut)
async def report_execution(
    pid: uuid.UUID, payload: ExecutionIn,
    db: AsyncSession = Depends(get_db), user: dict = Depends(require_permission("governance.propose")),
):
    p = await service.get_or_404(db, pid)
    return await service.set_execution(db, p, payload.status, payload.comment, _username(user))


@router.patch("/proposals/{pid}/effort", response_model=ProposalOut)
async def set_effort_hours(
    pid: uuid.UUID, payload: EffortHoursIn,
    db: AsyncSession = Depends(get_db), user: dict = Depends(require_permission("governance.propose")),
):
    """Исполнитель проставляет трудоёмкость меры в часах вручную (п.13, В-41)."""
    p = await service.get_or_404(db, pid)
    uid = await resolve_user_id(db, user.get("id"))
    return await service.set_effort_hours(db, p, payload.effort_hours, uid)


@router.post("/proposals/{pid}/rewrite-for-executor", response_model=ProposalOut)
async def rewrite_for_executor(
    pid: uuid.UUID,
    db: AsyncSession = Depends(get_db), user: dict = Depends(require_permission("governance.propose")),
):
    """Переписать меру на язык исполнителя — конкретные шаги для «Плана задач» (п.16)."""
    p = await service.get_or_404(db, pid)
    uid = await resolve_user_id(db, user.get("id"))
    return await service.rewrite_for_executor(db, p, uid)


@router.patch("/proposals/{pid}/task", response_model=ProposalOut)
async def update_task(
    pid: uuid.UUID, payload: TaskUpdateIn,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("governance.propose")),
):
    p = await service.get_or_404(db, pid)
    return await service.update_task(db, p, payload)


@router.post("/proposals/{pid}/escalate", response_model=ProposalOut)
async def escalate(
    pid: uuid.UUID, payload: EscalateIn,
    db: AsyncSession = Depends(get_db), user: dict = Depends(require_permission("governance.propose")),
):
    p = await service.get_or_404(db, pid)
    return await service.escalate(db, p, payload.reason, _username(user))


@router.post("/proposals/{pid}/escalation-decision", response_model=ProposalOut)
async def decide_escalation(
    pid: uuid.UUID, payload: EscalationDecisionIn,
    db: AsyncSession = Depends(get_db), user: dict = Depends(require_permission("governance.decide")),
):
    p = await service.get_or_404(db, pid)
    return await service.decide_escalation(db, p, payload.decision, payload.comment, _username(user))


@router.post("/proposals/{pid}/resolve-escalation", response_model=ProposalOut)
async def resolve_escalation(
    pid: uuid.UUID,
    db: AsyncSession = Depends(get_db), _: dict = Depends(require_permission("governance.propose")),
):
    p = await service.get_or_404(db, pid)
    return await service.resolve_escalation(db, p)


# ── BL-007 (RE-11/12/13): экономика меры ──

@router.put("/proposals/{pid}/economics", response_model=ProposalOut)
async def set_economics(
    pid: uuid.UUID, payload: MeasureEconomicsIn,
    db: AsyncSession = Depends(get_db), _: dict = Depends(require_permission("econ.ref.edit")),
):
    """Ввод экономических параметров меры (CAPEX/OPEX/лаг/ΔScore/тип). Расчёт ROSI — отдельным вызовом."""
    p = await service.get_or_404(db, pid)
    return await economics_service.set_measure_economics(db, p, payload)


@router.post("/proposals/{pid}/recompute-economics", response_model=MeasureEconomicsResult)
async def recompute_economics(
    pid: uuid.UUID,
    db: AsyncSession = Depends(get_db), _: dict = Depends(require_permission("econ.ref.edit")),
):
    """ROSI + рекомендованный вердикт (устранить/компенсировать/принять) по портфелю снимаемых рисков."""
    p = await service.get_or_404(db, pid)
    return await economics_service.recompute_economics(db, p)


@router.get("/proposals/{pid}/management-summary", response_model=management_summary.ManagementSummaryOut)
async def get_management_summary(
    pid: uuid.UUID,
    db: AsyncSession = Depends(get_db), _: dict = Depends(get_current_user),
):
    """Карточка меры на языке топ-менеджмента (п.14): что не так → деньги/срок → решение →
    стоимость → результат → ответственный, ≤80 слов, без формул (см. модуль)."""
    p = await service.get_or_404(db, pid)
    return management_summary.build_management_summary(p)


# ── ТЗ v19 §17 (Пункт 17): карточка поручения, критичность, Ц_ОМ ──

@router.get("/proposals/{pid}/price-of-inaction", response_model=PriceOfInactionOut)
async def get_price_of_inaction(
    pid: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_permission("view.risk_economics", "view.measure_economics.own")),
):
    """Ц_ОМ на карточке (§17.4). Держатель только `view.measure_economics.own` (обычно
    EXECUTOR) видит цену неисполнения ТОЛЬКО своей меры — общий `view.risk_economics` видит
    любую (менеджмент/риск-менеджер)."""
    p = await service.get_or_404(db, pid)
    granted = await get_role_permissions(db, (user.get("roles") or [""])[0])
    if "view.risk_economics" not in granted:
        uid = await resolve_user_id(db, user.get("id"))
        if uid is None or p.owner_user_id != uid:
            raise HTTPException(status_code=403, detail="Доступна только цена неисполнения своей меры")
    return await economics_service.compute_price_of_inaction(db, p)


@router.post("/proposals/{pid}/price-of-inaction/recompute", response_model=ProposalOut)
async def recompute_price_of_inaction(
    pid: uuid.UUID,
    db: AsyncSession = Depends(get_db), _: dict = Depends(require_permission("governance.propose")),
):
    """Пересчёт по кнопке (кроме ежедневной фоновой задачи, governance/tasks.py)."""
    p = await service.get_or_404(db, pid)
    return await economics_service.recompute_price_of_inaction(db, p)


@router.get("/proposals/{pid}/price-of-inaction/history", response_model=PriceHistoryOut)
async def get_price_of_inaction_history(
    pid: uuid.UUID, period: str = "quarter",
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_permission("view.risk_economics", "view.measure_economics.own")),
):
    """История Ц_ОМ по дням за период (§17.4, УК-51) — тот же гейт видимости, что у
    price-of-inaction (своя мера для EXECUTOR, любая для менеджмента)."""
    p = await service.get_or_404(db, pid)
    granted = await get_role_permissions(db, (user.get("roles") or [""])[0])
    if "view.risk_economics" not in granted:
        uid = await resolve_user_id(db, user.get("id"))
        if uid is None or p.owner_user_id != uid:
            raise HTTPException(status_code=403, detail="Доступна только цена неисполнения своей меры")
    if period not in ("day", "quarter"):
        raise HTTPException(status_code=422, detail="period должен быть 'day' или 'quarter'")
    return await economics_service.price_history(db, pid, period=period)


@router.get("/proposals/{pid}/effect-timeline", response_model=EffectTimelineOut)
async def get_effect_timeline(
    pid: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("view.risk_economics")),
):
    """Горизонт эффекта меры по кварталам (§15, УК-37): дата старта, лаг, дата выхода на
    эффект, накопленный эффект, точка окупаемости."""
    p = await service.get_or_404(db, pid)
    return economics_service.effect_timeline(p)


@router.patch("/proposals/{pid}/systemic-scope", response_model=ProposalOut)
async def update_systemic_scope(
    pid: uuid.UUID, payload: SystemicScopeIn,
    db: AsyncSession = Depends(get_db), user: dict = Depends(require_permission("governance.propose")),
):
    """Ручной анализ системности (§17.3, УК-46) — приоритетнее LLM-пометки."""
    p = await service.get_or_404(db, pid)
    return await service.set_systemic_scope(db, p, payload.note, _username(user))


@router.post("/proposals/{pid}/systemic-scope/refresh", response_model=ProposalOut)
async def refresh_systemic_scope(
    pid: uuid.UUID,
    db: AsyncSession = Depends(get_db), _: dict = Depends(require_permission("governance.propose")),
):
    """Пересчёт числа систем/LLM-пометки без изменения ручного анализа (§17.3)."""
    p = await service.get_or_404(db, pid)
    return await service.refresh_systemic_scope(db, p)


@router.patch("/proposals/{pid}/alternatives", response_model=ProposalOut)
async def update_alternatives(
    pid: uuid.UUID, payload: AlternativesIn,
    db: AsyncSession = Depends(get_db), user: dict = Depends(require_permission("governance.propose")),
):
    """Альтернативные варианты решения на карточке эскалации (§17.3, УК-48)."""
    p = await service.get_or_404(db, pid)
    alternatives = [a.model_dump(by_alias=False) for a in payload.alternatives]
    return await service.set_alternative_solutions(db, p, alternatives, _username(user))


@router.post("/proposals/{pid}/llm-review", response_model=ProposalOut)
async def review_llm_measure(
    pid: uuid.UUID, payload: LlmReviewIn,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_permission("governance.propose", "risk.register.edit")),
):
    """Обязательное ревью LLM-рекомендации перед эскалацией (§17.6, УК-56) —
    QUALITY_MANAGER (governance.propose) или RISK_MANAGER (risk.register.edit)."""
    p = await service.get_or_404(db, pid)
    uid = await resolve_user_id(db, user.get("id"))
    return await service.mark_llm_reviewed(db, p, payload.approved, payload.comment, _username(user), uid)


@router.get("/measure-departments", response_model=list[MeasureDepartmentOut])
async def list_measure_departments(
    db: AsyncSession = Depends(get_db), _: dict = Depends(get_current_user),
):
    """Временный справочник направлений (§17.3, УК-47) — характеристика → направление."""
    return await service.list_departments(db)


@router.put("/measure-departments", response_model=MeasureDepartmentOut)
async def upsert_measure_department(
    payload: MeasureDepartmentIn,
    db: AsyncSession = Depends(get_db), user: dict = Depends(require_permission("admin.permissions.manage")),
):
    """Ведение справочника — SUPER_ADMIN (В-58: рекомендация — тот же уровень, что настройка
    прав, пока не решено иначе)."""
    uid = await resolve_user_id(db, user.get("id"))
    return await service.set_department(db, payload, uid)


# ── §17.7 (УК-57): факт по бюджету/трудоёмкости (перерасход), отдельная фаза после Ц_ОМ ──

@router.patch("/proposals/{pid}/actuals", response_model=ProposalOut)
async def set_actuals(
    pid: uuid.UUID, payload: ActualsIn,
    db: AsyncSession = Depends(get_db), user: dict = Depends(require_permission("governance.propose")),
):
    """Факт по бюджету — вносит исполнитель по завершении меры (§17.7, решение 7.1)."""
    p = await service.get_or_404(db, pid)
    uid = await resolve_user_id(db, user.get("id"))
    return await service.set_actuals(
        db, p, payload.actual_capex, payload.actual_opex, payload.actual_effort_hours, uid,
    )


@router.get("/proposals/{pid}/budget-variance", response_model=BudgetVarianceOut)
async def get_budget_variance(
    pid: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_permission("view.risk_economics", "view.measure_economics.own")),
):
    """План/факт по мере (§17.7) — тот же гейт видимости, что у Ц_ОМ (своя мера для EXECUTOR,
    любая для менеджмента)."""
    p = await service.get_or_404(db, pid)
    granted = await get_role_permissions(db, (user.get("roles") or [""])[0])
    if "view.risk_economics" not in granted:
        uid = await resolve_user_id(db, user.get("id"))
        if uid is None or p.owner_user_id != uid:
            raise HTTPException(status_code=403, detail="Доступен только план/факт своей меры")
    return service.budget_variance(p)
