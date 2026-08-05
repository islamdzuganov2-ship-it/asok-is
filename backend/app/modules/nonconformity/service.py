"""
Логика домена nonconformity (BL-007, RE-14) — жизненный цикл замыкания контура.

Статус двигается ТОЛЬКО через действия (evaluate/decide/assign/start/execute/verify), не свободным
PATCH — иначе несоответствие «зависает» на «Выявлено» и система превращается в аудит ради аудита
(§0, §3.3). Ключевые инварианты: обязательный владелец; порядок статусов; для ACCEPT — подпись и дата
пересмотра; «Верифицировано» ставит НЕ тот, кто оценивал/исполнял (SoD).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.econ import config_value
from app.modules.governance import Proposal
from app.modules.nonconformity.models import (
    EVIDENCE_TYPES,
    LEVELS,
    STATUS_DECIDED,
    STATUS_EVALUATED,
    STATUS_EXECUTED,
    STATUS_FLOW,
    STATUS_IDENTIFIED,
    STATUS_IN_PROGRESS,
    STATUS_MEASURE_ASSIGNED,
    STATUS_VERIFIED,
    Nonconformity,
)
from app.modules.nonconformity.schemas import (
    ClosureFunnelOut,
    DecideIn,
    FunnelStage,
    NonconformityCreate,
)
from app.shared.exceptions import ConflictError, NotFoundError, ValidationError

# Вердикты решения (зеркалят governance VERDICTS).
VERDICT_ELIMINATE = "ELIMINATE"
VERDICT_COMPENSATE = "COMPENSATE"
VERDICT_ACCEPT = "ACCEPT"
VERDICTS = (VERDICT_ELIMINATE, VERDICT_COMPENSATE, VERDICT_ACCEPT)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _require_status(nc: Nonconformity, expected: str) -> None:
    if nc.status != expected:
        raise ConflictError(f"Недопустимый переход: статус «{nc.status}», ожидался «{expected}»")


def _log(nc: Nonconformity, by: str | None, action: str, to_status: str) -> None:
    rec = {"at": _now().isoformat(), "by": by or "—", "action": action,
           "from": nc.status, "to": to_status}
    nc.history = (nc.history or []) + [rec]


async def _acceptance_level_for(db: AsyncSession, ale: float | None) -> str | None:
    """Подписант по матрице акцепта (§3.3): первый порог, в который укладывается ALE."""
    matrix = await config_value(db, "acceptance_matrix", []) or []
    for entry in matrix:
        cap = entry.get("max_ale")
        if cap is None or (ale is not None and float(ale) <= float(cap)):
            return entry.get("signer")
    return None


# ═══════════════════════ CRUD/чтение ═══════════════════════

async def list_nonconformities(
    db: AsyncSession, *, system: str | None = None, status: str | None = None,
    include_demo: bool = True,
) -> list[Nonconformity]:
    stmt = select(Nonconformity)
    if system:
        stmt = stmt.where(Nonconformity.system_name == system)
    if status:
        stmt = stmt.where(Nonconformity.status == status)
    if not include_demo:
        stmt = stmt.where(Nonconformity.is_demo.is_(False))
    return list((await db.execute(stmt.order_by(Nonconformity.created_at.desc()))).scalars().all())


async def get_or_404(db: AsyncSession, nc_id: uuid.UUID) -> Nonconformity:
    nc = await db.get(Nonconformity, nc_id)
    if nc is None:
        raise NotFoundError("Несоответствие не найдено")
    return nc


async def create(db: AsyncSession, data: NonconformityCreate, username: str | None) -> Nonconformity:
    if not (data.owner or "").strip():
        raise ValidationError("Владелец несоответствия обязателен (§3.3)")
    if data.level not in LEVELS:
        raise ValidationError(f"Недопустимый уровень несоответствия: {data.level}")
    if data.evidence_type is not None and data.evidence_type not in EVIDENCE_TYPES:
        raise ValidationError(f"Недопустимый тип доказательства: {data.evidence_type}")
    nc = Nonconformity(**data.model_dump(exclude_none=True), status=STATUS_IDENTIFIED, created_by=username)
    db.add(nc)
    await db.commit()
    await db.refresh(nc)
    return nc


# ═══════════════════════ Жизненный цикл (§3.3) ═══════════════════════

async def evaluate(db: AsyncSession, nc: Nonconformity, evaluated_ale: float, username: str | None) -> Nonconformity:
    """Оценено (₽): фиксируем ALE и SLA на решение (>N дней без решения → эскалация)."""
    _require_status(nc, STATUS_IDENTIFIED)
    sla_days = int(await config_value(db, "nc_sla_days", 30) or 30)
    _log(nc, username, "evaluate", STATUS_EVALUATED)
    nc.evaluated_ale = evaluated_ale
    nc.sla_due = _now() + timedelta(days=sla_days)
    nc.status = STATUS_EVALUATED
    await db.commit()
    await db.refresh(nc)
    return nc


async def decide(db: AsyncSession, nc: Nonconformity, data: DecideIn, username: str | None) -> Nonconformity:
    """Решение принято: устранить / компенсировать / принять. ACCEPT требует подписи и даты пересмотра."""
    _require_status(nc, STATUS_EVALUATED)
    if data.verdict not in VERDICTS:
        raise ValidationError(f"Недопустимый вердикт: {data.verdict}")
    _log(nc, username, f"decide:{data.verdict}", STATUS_DECIDED)
    nc.decision_verdict = data.verdict
    if data.verdict == VERDICT_ACCEPT:
        if not (data.signed_by or "").strip():
            raise ValidationError("Принятие риска требует подписанта (signedBy)")
        nc.signed_by = data.signed_by
        nc.acceptance_level = data.acceptance_level or await _acceptance_level_for(db, nc.evaluated_ale)
        review_months = int(await config_value(db, "nc_review_months", 6) or 6)
        nc.review_date = _now() + timedelta(days=30 * review_months)
    nc.status = STATUS_DECIDED
    await db.commit()
    await db.refresh(nc)
    return nc


async def assign_measure(db: AsyncSession, nc: Nonconformity, proposal_id: uuid.UUID,
                         username: str | None) -> Nonconformity:
    """Мера назначена. Только для вердиктов «устранить»/«компенсировать» (у «принять» меры нет)."""
    _require_status(nc, STATUS_DECIDED)
    if nc.decision_verdict not in (VERDICT_ELIMINATE, VERDICT_COMPENSATE):
        raise ConflictError("Назначить меру можно только при вердикте «устранить»/«компенсировать»")
    if await db.get(Proposal, proposal_id) is None:
        raise NotFoundError("Мера (proposal) не найдена")
    _log(nc, username, "assign_measure", STATUS_MEASURE_ASSIGNED)
    nc.proposal_id = proposal_id
    nc.status = STATUS_MEASURE_ASSIGNED
    await db.commit()
    await db.refresh(nc)
    return nc


async def start(db: AsyncSession, nc: Nonconformity, username: str | None) -> Nonconformity:
    """В работе."""
    _require_status(nc, STATUS_MEASURE_ASSIGNED)
    _log(nc, username, "start", STATUS_IN_PROGRESS)
    nc.status = STATUS_IN_PROGRESS
    await db.commit()
    await db.refresh(nc)
    return nc


async def execute(db: AsyncSession, nc: Nonconformity, executed_by: str | None, comment: str | None) -> Nonconformity:
    """Исполнено — ставит ИСПОЛНИТЕЛЬ (не аудитор)."""
    _require_status(nc, STATUS_IN_PROGRESS)
    _log(nc, executed_by, "execute", STATUS_EXECUTED)
    nc.executed_by = executed_by
    nc.executed_at = _now()
    nc.status = STATUS_EXECUTED
    await db.commit()
    await db.refresh(nc)
    return nc


async def verify(db: AsyncSession, nc: Nonconformity, verified_by: str | None,
                 delta_score_confirmed: float | None) -> Nonconformity:
    """Верифицировано — ставит ТОЛЬКО независимый аудитор. SoD: не тот, кто оценивал/исполнял (§3.3)."""
    _require_status(nc, STATUS_EXECUTED)
    who = (verified_by or "").strip()
    if not who:
        raise ValidationError("Верификатор обязателен")
    if who in {(nc.owner or "").strip(), (nc.executed_by or "").strip()}:
        raise ValidationError("Верифицировать не может тот, кто оценивал или исполнял меру (SoD §3.3)")
    _log(nc, verified_by, "verify", STATUS_VERIFIED)
    nc.verified_by = verified_by
    nc.verified_at = _now()
    nc.delta_score_confirmed = delta_score_confirmed
    nc.status = STATUS_VERIFIED
    await db.commit()
    await db.refresh(nc)
    return nc


# ═══════════════════════ Воронка замкнутости (§5, виджет 6) ═══════════════════════

async def closure_funnel(db: AsyncSession, *, include_demo: bool = True) -> ClosureFunnelOut:
    """% несоответствий, дошедших до «Верифицировано» — главный анти-KPI аудита ради аудита (§3.3)."""
    stmt = select(Nonconformity.status, func.count()).group_by(Nonconformity.status)
    if not include_demo:
        stmt = stmt.where(Nonconformity.is_demo.is_(False))
    counts = {status: cnt for status, cnt in (await db.execute(stmt)).all()}
    total = sum(counts.values())
    verified = counts.get(STATUS_VERIFIED, 0)
    stages = [FunnelStage(status=s, count=counts.get(s, 0)) for s in STATUS_FLOW]
    rate = round(verified / total * 100, 1) if total else 0.0
    return ClosureFunnelOut(total=total, verified=verified, closure_rate=rate, stages=stages)
