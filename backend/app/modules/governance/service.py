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
    STATUS_APPROVED,
    STATUS_PENDING,
    STATUS_REJECTED,
    Proposal,
)
from app.modules.governance.schemas import (
    EditIn,
    MetaIn,
    ProposalCreate,
    TaskUpdateIn,
)
from app.infrastructure.integrations.notifications import get_notification_port
from app.modules.llm import generate_executor_brief
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
    include_demo: bool = True,
) -> list[Proposal]:
    stmt = select(Proposal)
    if system:
        stmt = stmt.where(Proposal.system_name == system)
    if status:
        stmt = stmt.where(Proposal.status == status)
    if not include_demo:
        stmt = stmt.where(Proposal.is_demo.is_(False))
    stmt = stmt.order_by(Proposal.created_at.desc())
    return list((await db.execute(stmt)).scalars().all())


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
    )
    db.add(p)
    await db.commit()
    await db.refresh(p)
    return p


async def decide(db: AsyncSession, p: Proposal, approve: bool, comment: str | None, username: str) -> Proposal:
    if p.status != STATUS_PENDING:
        raise ConflictError("Решение можно принять только по мере, ожидающей одобрения")
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
