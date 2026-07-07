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
from app.shared.exceptions import ConflictError, NotFoundError, ValidationError


def _now() -> datetime:
    return datetime.now(timezone.utc)


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
    return p


async def resolve_escalation(db: AsyncSession, p: Proposal) -> Proposal:
    """«Отработано» менеджером по качеству — цикл эскалации закрыт."""
    p.escalated = False
    await db.commit()
    await db.refresh(p)
    return p
