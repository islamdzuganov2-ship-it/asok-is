"""
Логика домена governance (T-10): операции над мерами + инварианты статусов (SoD-петля v12).

Ролевые проверки (кто может делать) — в роутере через require_role. Здесь — инварианты
СОСТОЯНИЯ (когда действие допустимо): решение только по ожидающей мере, исполнение только по
одобренной и т.п. Нарушение → ConflictError (→ HTTP 409).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from pydantic.alias_generators import to_camel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.governance.models import (
    EXECUTION_DONE,
    EXECUTION_NOT_DONE,
    ESCALATION_IGNORE,
    ESCALATION_REQUEST_MEASURES,
    MEASURE_SOURCE_LLM,
    MeasureDepartment,
    STATUS_APPROVED,
    STATUS_PENDING,
    STATUS_REJECTED,
    Proposal,
)
from app.modules.governance.schemas import (
    AlternativesIn,
    EditIn,
    LlmReviewIn,
    MeasureDepartmentIn,
    MetaIn,
    ProposalCreate,
    SystemicScopeIn,
    TaskUpdateIn,
)
from app.infrastructure.integrations.notifications import get_notification_port
from app.modules.iam import get_role_permissions, resolve_user_id
from app.modules.llm import generate_executor_brief
from app.shared.dates import parse_ru_date
from app.shared.exceptions import ConflictError, NotFoundError, ValidationError
from app.shared.notification_events import (
    EVENT_MEASURE_APPROVED,
    EVENT_MEASURE_ESCALATED,
    EVENT_MEASURE_ESCALATION_DECIDED,
    EVENT_MEASURE_EXECUTOR_BRIEF_READY,
    EVENT_MEASURE_REJECTED,
    EVENT_TITLES,
)
from app.shared.ports import NotificationEvent

# §17.1/17.2: полное право решает всё; "минорное" — только меры без обязательной эскалации,
# и только QUALITY_MANAGER/ADMIN (любая мера) или EXECUTOR-владелец (только своя мера, §17.1).
FULL_DECIDE_PERMISSION = "governance.decide"
MINOR_DECIDE_PERMISSION = "governance.decide.minor"
_MINOR_DECIDE_ANY_MEASURE_ROLES = ("QUALITY_MANAGER", "ADMIN")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _notify(event_type: str, recipient: str | None, p: Proposal, body: str) -> None:
    """Эмитит событие уведомления через порт (ТЗ v19 п.6) — доставка вне зоны ответственности
    домена (см. shared/ports.py, infrastructure/integrations/notifications). Без получателя
    (owner/created_by не заполнены) событие не эмитим — заглушка молча «доставила» бы уведомление
    в никуда, это маскирует пробел в данных, а не сообщает о нём (см. resolve_user_id — тот же
    принцип: честное отсутствие, не тихая имитация действия)."""
    if not recipient or not recipient.strip():
        return
    get_notification_port().notify(NotificationEvent(
        event_type=event_type, recipient=recipient.strip(),
        subject=f"{EVENT_TITLES[event_type]}: {p.risk_title or p.metric_name or p.system_name}",
        body=body, entity_type="proposal", entity_id=str(p.id),
    ))


async def list_proposals(
    db: AsyncSession, *, system: str | None = None, status: str | None = None,
    include_demo: bool = True, order_by: str = "priority",
) -> list[Proposal]:
    stmt = select(Proposal)
    if system:
        stmt = stmt.where(Proposal.system_name == system)
    if status:
        stmt = stmt.where(Proposal.status == status)
    if not include_demo:
        stmt = stmt.where(Proposal.is_demo.is_(False))
    if order_by != "priority":
        stmt = stmt.order_by(Proposal.created_at.desc())
        return list((await db.execute(stmt)).scalars().all())

    # §17.5 (УК-52): очередь по составному весу вместо created_at. N+1 запросов по деньгам под
    # риском — приемлемо для пилотного объёма (В-39 не блокирует); серверная SQL-сортировка
    # добавится отдельно при росте объёмов, см. §17.5 критерии приёмки.
    rows = list((await db.execute(stmt)).scalars().all())
    weight_by_char = await _priority_weight_lookup(db)
    triples = [(p, *(await _priority_components(db, p, weight_by_char))) for p in rows]
    _attach_priority_fields(triples)
    triples.sort(key=lambda t: t[3], reverse=True)
    return [p for p, *_ in triples]


async def _priority_weight_lookup(db: AsyncSession) -> dict[str, float]:
    """Вес ХАРАКТЕРИСТИКИ (§1.0 ГОСТ) — тот же источник, что и взвешенный порог эскалации
    (economics_service._characteristic_weight_ratio, §17.5 УК-53), см. weights_service.
    weight_by_characteristic.

    Импорт ОТЛОЖЕН (не на уровне модуля): weights_service тянет econ, а governance/__init__.py
    грузится из глубины цепочки econ.router→manager_metrics_service→governance.models — импорт
    econ.* на уровне модуля governance/service.py даёт циклический импорт при старте приложения
    (econ ещё не успел доопределить свои имена). На вызов функции (после старта) цикла уже нет."""
    from app.modules.econ.weights_service import weight_by_characteristic

    return await weight_by_characteristic(db)


async def _priority_components(
    db: AsyncSession, p: Proposal, weight_by_char: dict[str, float],
) -> tuple[float, float, float]:
    """(вес_характеристики, деньги_под_риском, итоговый_ключ) — §17.5, УК-52/53. Итоговый ключ —
    вес × деньги, с двукратной надбавкой за просрочку (Ц_ОМ считается отдельно, ежедневно,
    см. economics_service.recompute_price_of_inaction — здесь только ориентир для очереди)."""
    from app.modules.governance.economics_service import measure_ale_risk_value

    w = weight_by_char.get(p.characteristic or "", 0.0) or 0.01  # неизвестная характеристика — не 0
    ale_risk = await measure_ale_risk_value(db, p.id)
    overdue = p.execution != EXECUTION_DONE and p.due_on is not None and p.due_on < _now()
    key = w * max(ale_risk, 1.0) * (2.0 if overdue else 1.0)
    return w, ale_risk, key


def _attach_priority_fields(triples: list[tuple[Proposal, float, float, float]]) -> None:
    """§17.5 критерии приёмки: помечает «нетипичный порядок» — деньги продвинули меру на
    малозначимой характеристике (нижняя половина по весу) в верхнюю четверть очереди. Пишет
    транзиентные атрибуты прямо на ORM-объект (не колонки, не коммитятся) — ProposalOut их
    подхватит через from_attributes. Не блокирует, только помечает (решение заказчика, 5.2)."""
    n = len(triples)
    if n == 0:
        return
    # Меньше 4 мер — «нижняя половина»/«верхняя четверть» не несут смысла (при n=1 любая
    # единственная мера тривиально попадала бы и туда, и туда) — не помечаем вообще.
    comparable = n >= 4
    by_weight = sorted(range(n), key=lambda i: triples[i][1])            # индексы, по весу возрастанию
    by_final = sorted(range(n), key=lambda i: triples[i][3], reverse=True)  # по итоговому ключу убыв.
    weight_rank = {idx: rank for rank, idx in enumerate(by_weight)}       # 0 = наименьший вес
    final_rank = {idx: rank for rank, idx in enumerate(by_final)}        # 0 = первый в очереди
    for i, (p, w, money, key) in enumerate(triples):
        p.priority_weight = round(w, 4)
        p.priority_money = round(money, 2)
        # нижняя половина по весу (weight_rank мал), но верхняя четверть очереди (final_rank мал)
        p.priority_is_atypical = comparable and weight_rank[i] < n / 2 and final_rank[i] < n // 4


async def get_or_404(db: AsyncSession, pid: uuid.UUID) -> Proposal:
    p = await db.get(Proposal, pid)
    if p is None:
        raise NotFoundError("Мера не найдена")
    return p


async def create(db: AsyncSession, data: ProposalCreate, username: str) -> Proposal:
    p = Proposal(
        **data.model_dump(exclude_none=False),
        status=STATUS_PENDING,
        created_by=username,
        # ТЗ v19 УК-36: due_on — источник истины, считается от due_date сразу при создании
        # (не только разовым backfill-скриптом), иначе новые меры навсегда остаются без due_on.
        due_on=parse_ru_date(data.due_date),
    )
    db.add(p)
    await db.commit()
    await db.refresh(p)
    return await apply_department(db, p)


async def _ensure_routable(db: AsyncSession, p: Proposal) -> None:
    """§17.2 (УК-42): без привязки к risk_event мера не может быть решена/эскалирована —
    кроме явно помеченных процессных мер (`is_process_measure`). Проверяется на действии, не
    на создании: линковка к risk_event идёт отдельным вызовом ПОСЛЕ создания Proposal."""
    if p.is_process_measure:
        return
    from app.modules.governance.economics_service import has_linked_risks

    if not await has_linked_risks(db, p.id):
        raise ValidationError(
            "Мера не привязана ни к одному рисковому событию (risk_event) — обязательно для "
            "решения/эскалации (§17.2, УК-42). Пометьте меру как процессную, если привязка "
            "неприменима.",
        )


async def can_self_decide(db: AsyncSession, p: Proposal, user: dict) -> bool:
    """§17.1/17.2: ниже денежного порога — решает QUALITY_MANAGER/ADMIN (любая мера) или сам
    ОМ-исполнитель на СВОЮ меру (owner_user_id совпадает), без выхода на governance.decide."""
    from app.modules.governance.economics_service import route_measure

    escalate, _ = await route_measure(db, p)
    if escalate:
        return False
    roles = user.get("roles", [])
    if any(r in _MINOR_DECIDE_ANY_MEASURE_ROLES for r in roles):
        return True
    if "EXECUTOR" in roles:
        uid = await resolve_user_id(db, user.get("id"))
        return uid is not None and p.owner_user_id is not None and p.owner_user_id == uid
    return False


async def decide(
    db: AsyncSession, p: Proposal, approve: bool, comment: str | None, username: str,
    user: dict | None = None,
) -> Proposal:
    if p.status != STATUS_PENDING:
        raise ConflictError("Решение можно принять только по мере, ожидающей одобрения")
    await _ensure_routable(db, p)

    # §17.1/17.2: если у вызывающего нет ПОЛНОГО права (только «минорное»), решение допустимо
    # только для мер ниже порога маршрутизации и только своей ролью (QUALITY_MANAGER/ADMIN —
    # любая; EXECUTOR — только своя). Роутер уже пропустил по require_permission(full ИЛИ minor).
    escalation_required = False
    if user is not None:
        granted = await get_role_permissions(db, (user.get("roles") or [""])[0])
        if FULL_DECIDE_PERMISSION not in granted:
            if not await can_self_decide(db, p, user):
                raise ConflictError(
                    "Эта мера требует эскалации к топ-менеджменту (порог/критичность §17.2) — "
                    "самостоятельное решение недоступно",
                )
        else:
            from app.modules.governance.economics_service import route_measure

            escalation_required, _ = await route_measure(db, p)

    # §17.6 (УК-56): LLM-рекомендация без ревью QUALITY_MANAGER/RISK_MANAGER не может дойти
    # до решения топ-менеджмента — гейт применяется именно на пути эскалации, не на самостоятельном
    # решении QUALITY_MANAGER (тот и есть ревьюер по построению SoD, см. §17.6).
    if escalation_required and llm_review_pending(p):
        raise ConflictError(
            "Мера предложена LLM и ещё не прошла обязательное ревью QUALITY_MANAGER/"
            "RISK_MANAGER (§17.6, УК-56) — решение топ-менеджмента недоступно до ревью",
        )

    p.status = STATUS_APPROVED if approve else STATUS_REJECTED
    p.decided_by = username
    p.decided_at = _now()
    p.decision_comment = comment
    await db.commit()
    await db.refresh(p)
    _notify(
        EVENT_MEASURE_APPROVED if approve else EVENT_MEASURE_REJECTED, p.created_by, p,
        f"Решение: {username}. " + (comment.strip() if comment else "без комментария."),
    )
    return p


async def update_meta(db: AsyncSession, p: Proposal, data: MetaIn, username: str) -> Proposal:
    """Смена ответственного/срока топ-менеджментом — только до решения (ролевая модель v12)."""
    if p.status != STATUS_PENDING:
        raise ConflictError("Менять ответственного/срок можно только до решения по мере")
    changes = _apply_with_history(p, data.model_dump(exclude_unset=True), username)
    if changes:
        await db.commit()
        await db.refresh(p)
    return p


async def edit(db: AsyncSession, p: Proposal, patch: EditIn, username: str) -> Proposal:
    """Правка меры топ-менеджментом с записью в историю (аудит)."""
    changes = _apply_with_history(p, patch.model_dump(exclude_unset=True), username)
    if changes:
        await db.commit()
        await db.refresh(p)
    return p


def _apply_with_history(p: Proposal, patch: dict, username: str) -> int:
    """Применяет изменённые поля, каждое пишет в history (camelCase-поле, было→стало)."""
    at = _now().isoformat()
    history = list(p.history or [])
    changed = 0
    for field, value in patch.items():
        if value is None:
            continue
        prev = getattr(p, field, None)
        if str(value) == str(prev or ""):
            continue
        history.append({
            "at": at, "by": username, "field": to_camel(field),
            "from": str(prev) if prev else None, "to": str(value) or None,
        })
        setattr(p, field, value)
        changed += 1
        # ТЗ v19 УК-36: due_date правится и топ-менеджментом (MetaIn), и аудитом (EditIn) —
        # due_on должен пересчитываться при каждой правке, иначе разъезжается с due_date молча
        # после первого редактирования (backfill_due_dates.py закрывает это только один раз).
        if field == "due_date":
            p.due_on = parse_ru_date(value)
    if changed:
        p.history = history
    return changed


async def set_execution(db: AsyncSession, p: Proposal, status: str, comment: str, username: str) -> Proposal:
    """Контроль исполнения менеджером по качеству — только по одобренной мере (SoD v12)."""
    if p.status != STATUS_APPROVED:
        raise ConflictError("Отметить исполнение можно только по одобренной мере")
    if status not in (EXECUTION_DONE, EXECUTION_NOT_DONE):
        raise ValidationError("Некорректный статус исполнения")
    if not comment or not comment.strip():
        raise ValidationError("Комментарий об исполнении обязателен")
    p.execution = status
    p.execution_comment = comment
    p.executed_by = username
    p.executed_at = _now()
    await db.commit()
    await db.refresh(p)
    return p


async def set_effort_hours(
    db: AsyncSession, p: Proposal, hours: float, user_id: uuid.UUID | None,
) -> Proposal:
    """Трудоёмкость проставляет исполнитель вручную (В-41) — только по одобренной мере,
    величина > 0 (оценка «ноль часов» бессмысленна и маскирует отсутствие оценки)."""
    if p.status != STATUS_APPROVED:
        raise ConflictError("Трудоёмкость можно указать только по одобренной мере")
    if hours <= 0:
        raise ValidationError("Трудоёмкость должна быть больше нуля")
    p.effort_hours = hours
    p.effort_hours_set_by = user_id
    p.effort_hours_set_at = _now()
    await db.commit()
    await db.refresh(p)
    return p


# ═══════════════════════ §17.7 (УК-57): факт по бюджету/трудоёмкости ═══════════════════════

async def set_actuals(
    db: AsyncSession, p: Proposal, capex: float | None, opex: float | None,
    effort_hours: float | None, user_id: uuid.UUID | None,
) -> Proposal:
    """Факт по бюджету — вносит исполнитель по завершении меры (решение заказчика 7.1).
    Только по одобренной и выполненной мере (§17.7 отдельная фаза после Ц_ОМ, но тот же
    инвариант, что и для effort_hours/execution): факт без исполнения — нечего сверять."""
    if p.status != STATUS_APPROVED or p.execution != EXECUTION_DONE:
        raise ConflictError("Факт по бюджету можно внести только по выполненной (execution=DONE) мере")
    if capex is None and opex is None and effort_hours is None:
        raise ValidationError("Укажите хотя бы одно значение факта (CAPEX/OPEX/часы)")
    if capex is not None:
        p.actual_capex = capex
    if opex is not None:
        p.actual_opex = opex
    if effort_hours is not None:
        p.actual_effort_hours = effort_hours
    p.actuals_set_by = user_id
    p.actuals_set_at = _now()
    await db.commit()
    await db.refresh(p)
    return p


def budget_variance(p: Proposal) -> dict:
    """План/факт (§17.7) — variance = факт − план, None при отсутствии любой из сторон
    (честное «не оценено», не 0 молча — тот же принцип, что effort_hours В-41)."""
    def _variance(planned, actual):
        if planned is None or actual is None:
            return None
        return round(float(actual) - float(planned), 2)

    return {
        "proposal_id": p.id,
        "planned_capex": float(p.capex) if p.capex is not None else None,
        "actual_capex": float(p.actual_capex) if p.actual_capex is not None else None,
        "capex_variance": _variance(p.capex, p.actual_capex),
        "planned_opex": float(p.opex_per_year) if p.opex_per_year is not None else None,
        "actual_opex": float(p.actual_opex) if p.actual_opex is not None else None,
        "opex_variance": _variance(p.opex_per_year, p.actual_opex),
        "planned_effort_hours": float(p.effort_hours) if p.effort_hours is not None else None,
        "actual_effort_hours": float(p.actual_effort_hours) if p.actual_effort_hours is not None else None,
        "effort_variance": _variance(p.effort_hours, p.actual_effort_hours),
    }


async def rewrite_for_executor(db: AsyncSession, p: Proposal, user_id: uuid.UUID | None) -> Proposal:
    """Переписывает меру на язык исполнителя (п.16, персона EXECUTOR) — конкретные шаги вместо
    профсуждения (rationale) и вместо запроса решения у ЛПР (expectation, п.14, другой адресат).
    Только по одобренной мере: до решения переписывать для исполнения нечего (как и effort_hours,
    В-41) — исполнение начинается после одобрения, не раньше."""
    if p.status != STATUS_APPROVED:
        raise ConflictError("Переписать для исполнителя можно только по одобренной мере")
    if p.due_on:
        due_note = f"до {p.due_on.strftime('%d.%m.%Y')}"
    elif p.due_date:
        due_note = f"до {p.due_date}"
    else:
        due_note = "не назначен"
    text = generate_executor_brief(
        title=p.risk_title or p.metric_name or p.system_name,
        problem=p.rationale or "", ask=p.expectation or "", due_note=due_note,
    )
    p.executor_brief = text
    p.executor_brief_generated_by = user_id
    p.executor_brief_generated_at = _now()
    await db.commit()
    await db.refresh(p)
    _notify(EVENT_MEASURE_EXECUTOR_BRIEF_READY, p.owner, p, text)
    return p


async def update_task(db: AsyncSession, p: Proposal, data: TaskUpdateIn) -> Proposal:
    patch = data.model_dump(exclude_unset=True)
    for field, value in patch.items():
        if value is not None:
            setattr(p, field, value)
    await db.commit()
    await db.refresh(p)
    return p


async def escalate(db: AsyncSession, p: Proposal, reason: str, username: str) -> Proposal:
    """Эскалацию инициирует менеджер по качеству — обязательно с причиной."""
    if not reason or not reason.strip():
        raise ValidationError("Причина эскалации обязательна")
    p.escalated = True
    p.escalation_reason = reason
    p.escalation_decision = None
    p.escalation_decision_comment = None
    p.escalation_decided_by = None
    await db.commit()
    await db.refresh(p)
    # Эскалация адресована РОЛИ (SoD v12 §5.1), не конкретному человеку — получателя по
    # имени здесь нет и не должно быть; порт получает нейтральную роль-подпись.
    _notify(EVENT_MEASURE_ESCALATED, "топ-менеджмент", p, reason)
    return p


async def decide_escalation(db: AsyncSession, p: Proposal, decision: str, comment: str, username: str) -> Proposal:
    """Решение по эскалации — топ-менеджмент (игнорировать / запросить доп. меры)."""
    if not p.escalated:
        raise ConflictError("Нет активной эскалации по мере")
    if decision not in (ESCALATION_IGNORE, ESCALATION_REQUEST_MEASURES):
        raise ValidationError("Некорректное решение по эскалации")
    p.escalation_decision = decision
    p.escalation_decision_comment = comment
    p.escalation_decided_by = username
    await db.commit()
    await db.refresh(p)
    _notify(EVENT_MEASURE_ESCALATION_DECIDED, p.created_by, p,
            f"Решение: {username}. {comment.strip() if comment else ''}")
    return p


async def resolve_escalation(db: AsyncSession, p: Proposal) -> Proposal:
    """«Отработано» менеджером по качеству — цикл эскалации закрыт."""
    p.escalated = False
    await db.commit()
    await db.refresh(p)
    return p


# ═══════════════════════ §17.3 (УК-46/48): состав карточки эскалации ═══════════════════════

async def set_systemic_scope(db: AsyncSession, p: Proposal, note: str, username: str) -> Proposal:
    """Ручной анализ системности (QUALITY_MANAGER) — приоритетнее LLM-пометки, никогда ею не
    затирается. Пересчитывает и число систем, и LLM-пометку заново поверх нового ручного текста."""
    from app.modules.governance.systemic_scope import compute_systemic_scope

    changes = _apply_with_history(p, {"systemic_scope_note": note}, username)
    count, llm_note = await compute_systemic_scope(db, p)
    p.systemic_scope_system_count = count
    p.systemic_scope_llm_note = llm_note
    await db.commit()
    await db.refresh(p)
    return p


async def refresh_systemic_scope(db: AsyncSession, p: Proposal) -> Proposal:
    """Пересчёт числа систем/LLM-пометки БЕЗ изменения ручного анализа — вызывается при
    появлении новых связей риск↔ТС/риск↔мера, не только по кнопке пользователя."""
    from app.modules.governance.systemic_scope import compute_systemic_scope

    count, llm_note = await compute_systemic_scope(db, p)
    p.systemic_scope_system_count = count
    p.systemic_scope_llm_note = llm_note
    await db.commit()
    await db.refresh(p)
    return p


async def set_alternative_solutions(
    db: AsyncSession, p: Proposal, alternatives: list[dict], username: str,
) -> Proposal:
    """Альтернативные варианты решения на карточке эскалации (§17.3, УК-48)."""
    at = _now().isoformat()
    history = list(p.history or [])
    history.append({
        "at": at, "by": username, "field": "alternativeSolutions",
        "from": f"{len(p.alternative_solutions or [])} вариант(а)",
        "to": f"{len(alternatives)} вариант(а)",
    })
    p.alternative_solutions = alternatives
    p.history = history
    await db.commit()
    await db.refresh(p)
    return p


# ═══════════════════════ §17.6 (УК-55/56): источник и ревью LLM-рекомендаций ═══════════════════════

async def mark_llm_reviewed(
    db: AsyncSession, p: Proposal, approved: bool, comment: str | None,
    reviewer_username: str, reviewer_uid: uuid.UUID | None,
) -> Proposal:
    """Обязательное ревью перед эскалацией (УК-56): LLM-рекомендация не может дойти до
    governance.decide без этой отметки. `approved=False` возвращает меру к MANUAL — исходный
    текст остаётся (правит ревьюер вручную), метка «рекомендация LLM» снимается."""
    if p.measure_source != MEASURE_SOURCE_LLM:
        raise ConflictError("Ревью применимо только к мерам с источником LLM")
    at = _now().isoformat()
    history = list(p.history or [])
    history.append({
        "at": at, "by": reviewer_username, "field": "llmReview",
        "from": "LLM, не проверено", "to": ("одобрено" if approved else "отклонено") +
        (f": {comment.strip()}" if comment else ""),
    })
    p.history = history
    if approved:
        p.llm_reviewed_by = reviewer_uid
        p.llm_reviewed_at = _now()
    else:
        p.measure_source = "MANUAL"
        p.llm_reviewed_by = None
        p.llm_reviewed_at = None
    await db.commit()
    await db.refresh(p)
    return p


def llm_review_pending(p: Proposal) -> bool:
    """§17.6 (УК-56): гейт эскалации — LLM-текст без ревью не может уйти к топ-менеджменту."""
    return p.measure_source == MEASURE_SOURCE_LLM and p.llm_reviewed_by is None


# ═══════════════════════ §17.3 (УК-47): справочник направлений ═══════════════════════

async def list_departments(db: AsyncSession) -> list[MeasureDepartment]:
    stmt = select(MeasureDepartment).order_by(MeasureDepartment.characteristic)
    return list((await db.execute(stmt)).scalars().all())


async def set_department(
    db: AsyncSession, data: MeasureDepartmentIn, user_id: uuid.UUID | None,
) -> MeasureDepartment:
    """Upsert по характеристике — временный справочник (§17.3), задел под AD (УК-47)."""
    row = (await db.execute(
        select(MeasureDepartment).where(MeasureDepartment.characteristic == data.characteristic)
    )).scalar_one_or_none()
    if row is None:
        row = MeasureDepartment(characteristic=data.characteristic)
        db.add(row)
    row.department_name = data.department_name
    row.updated_by = user_id
    await db.commit()
    await db.refresh(row)
    return row


async def apply_department(db: AsyncSession, p: Proposal) -> Proposal:
    """Подставляет направление на карточку по характеристике меры (§17.3) — вызывается при
    создании/правке характеристики, идемпотентно (нет справочника для характеристики → без изменений)."""
    if not p.characteristic:
        return p
    row = (await db.execute(
        select(MeasureDepartment).where(MeasureDepartment.characteristic == p.characteristic)
    )).scalar_one_or_none()
    if row is not None and p.department != row.department_name:
        p.department = row.department_name
        await db.commit()
        await db.refresh(p)
    return p
