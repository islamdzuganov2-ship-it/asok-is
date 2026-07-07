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

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.database import get_db
from app.modules.governance import service
from app.modules.governance.schemas import (
    DecisionIn,
    EditIn,
    EscalateIn,
    EscalationDecisionIn,
    ExecutionIn,
    MetaIn,
    ProposalCreate,
    ProposalOut,
    TaskUpdateIn,
)
from app.modules.iam import get_current_user, require_role

router = APIRouter()

# SoD-уровни доступа (ролевая модель v12). ADMIN совмещает администрирование и решения.
DECISION_ROLES = ("ADMIN", "CTO", "CEO", "CIO", "EXECUTIVE")  # топ-менеджмент
MANAGER_ROLES = ("QUALITY_MANAGER", "ADMIN")                  # менеджер по качеству (+ADMIN супер)


def _username(user: dict) -> str:
    return user.get("username") or "—"


@router.get("/proposals", response_model=list[ProposalOut])
async def list_proposals(
    system: str | None = None,
    status: str | None = None,
    include_demo: bool = True,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(get_current_user),
) -> list:
    return await service.list_proposals(db, system=system, status=status, include_demo=include_demo)


@router.post("/proposals", response_model=ProposalOut, status_code=201)
async def create_proposal(
    payload: ProposalCreate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_role(*MANAGER_ROLES)),
):
    return await service.create(db, payload, _username(user))


@router.post("/proposals/{pid}/approve", response_model=ProposalOut)
async def approve_proposal(
    pid: uuid.UUID, payload: DecisionIn | None = None,
    db: AsyncSession = Depends(get_db), user: dict = Depends(require_role(*DECISION_ROLES)),
):
    p = await service.get_or_404(db, pid)
    return await service.decide(db, p, True, (payload.comment if payload else None), _username(user))


@router.post("/proposals/{pid}/reject", response_model=ProposalOut)
async def reject_proposal(
    pid: uuid.UUID, payload: DecisionIn | None = None,
    db: AsyncSession = Depends(get_db), user: dict = Depends(require_role(*DECISION_ROLES)),
):
    p = await service.get_or_404(db, pid)
    return await service.decide(db, p, False, (payload.comment if payload else None), _username(user))


@router.patch("/proposals/{pid}/meta", response_model=ProposalOut)
async def update_meta(
    pid: uuid.UUID, payload: MetaIn,
    db: AsyncSession = Depends(get_db), user: dict = Depends(require_role(*DECISION_ROLES)),
):
    p = await service.get_or_404(db, pid)
    return await service.update_meta(db, p, payload, _username(user))


@router.patch("/proposals/{pid}", response_model=ProposalOut)
async def edit_proposal(
    pid: uuid.UUID, payload: EditIn,
    db: AsyncSession = Depends(get_db), user: dict = Depends(require_role(*DECISION_ROLES)),
):
    p = await service.get_or_404(db, pid)
    return await service.edit(db, p, payload, _username(user))


@router.post("/proposals/{pid}/execution", response_model=ProposalOut)
async def report_execution(
    pid: uuid.UUID, payload: ExecutionIn,
    db: AsyncSession = Depends(get_db), user: dict = Depends(require_role(*MANAGER_ROLES)),
):
    p = await service.get_or_404(db, pid)
    return await service.set_execution(db, p, payload.status, payload.comment, _username(user))


@router.patch("/proposals/{pid}/task", response_model=ProposalOut)
async def update_task(
    pid: uuid.UUID, payload: TaskUpdateIn,
    db: AsyncSession = Depends(get_db), _: dict = Depends(get_current_user),
):
    p = await service.get_or_404(db, pid)
    return await service.update_task(db, p, payload)


@router.post("/proposals/{pid}/escalate", response_model=ProposalOut)
async def escalate(
    pid: uuid.UUID, payload: EscalateIn,
    db: AsyncSession = Depends(get_db), user: dict = Depends(require_role(*MANAGER_ROLES)),
):
    p = await service.get_or_404(db, pid)
    return await service.escalate(db, p, payload.reason, _username(user))


@router.post("/proposals/{pid}/escalation-decision", response_model=ProposalOut)
async def decide_escalation(
    pid: uuid.UUID, payload: EscalationDecisionIn,
    db: AsyncSession = Depends(get_db), user: dict = Depends(require_role(*DECISION_ROLES)),
):
    p = await service.get_or_404(db, pid)
    return await service.decide_escalation(db, p, payload.decision, payload.comment, _username(user))


@router.post("/proposals/{pid}/resolve-escalation", response_model=ProposalOut)
async def resolve_escalation(
    pid: uuid.UUID,
    db: AsyncSession = Depends(get_db), _: dict = Depends(require_role(*MANAGER_ROLES)),
):
    p = await service.get_or_404(db, pid)
    return await service.resolve_escalation(db, p)
