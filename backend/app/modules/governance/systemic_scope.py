"""
Анализ системности меры (ТЗ v19 §17.3, УК-46) — детерминированный подсчёт затронутых систем.

Прямые связи: система самой меры + системы технических сбоёв (`TechIncident`), привязанных
через риск-события меры (`RiskEventMeasure` → `RiskEvent` → `RiskEventIncident`). Косвенные
признаки: другие рисковые события той же категории риск-базы (`RiskBase.category`) с
пересечением ключевых слов (`RiskBase.keywords`), на СИСТЕМАХ, не входящих в прямой список.

Ручной анализ (`Proposal.systemic_scope_note`, вводит QUALITY_MANAGER) — приоритетнее: LLM
никогда не переписывает его, только дополняет пометкой-оговоркой `systemic_scope_llm_note`
рядом (§17.3, решение заказчика). Число системности (`systemic_scope_system_count`) считается
здесь всегда одинаково, независимо от наличия ручного анализа.
"""
from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.governance.models import Proposal
from app.modules.incidents import TechIncident
from app.modules.risk import RiskBase, RiskEvent, RiskEventIncident, RiskEventMeasure
from app.modules.systems import System


def _keywords(text: str | None) -> set[str]:
    return {kw.strip().lower() for kw in (text or "").split(",") if kw.strip()}


async def _linked_risk_events(db: AsyncSession, proposal_id: uuid.UUID) -> list[RiskEvent]:
    links = list((await db.execute(
        select(RiskEventMeasure.risk_event_id).where(RiskEventMeasure.proposal_id == proposal_id)
    )).scalars().all())
    if not links:
        return []
    return list((await db.execute(select(RiskEvent).where(RiskEvent.id.in_(links)))).scalars().all())


async def _direct_systems(db: AsyncSession, p: Proposal, events: list[RiskEvent]) -> set[str]:
    direct: set[str] = {p.system_name} if p.system_name else set()
    event_ids = [e.id for e in events]
    if not event_ids:
        return direct
    names = list((await db.execute(
        select(TechIncident.system_name)
        .join(RiskEventIncident, RiskEventIncident.incident_id == TechIncident.id)
        .where(RiskEventIncident.risk_event_id.in_(event_ids))
    )).scalars().all())
    direct.update(n for n in names if n)
    return direct


async def _indirect_systems(
    db: AsyncSession, events: list[RiskEvent], direct: set[str],
) -> set[str]:
    """Другие рисковые события той же категории риск-базы, с пересечением keywords, на
    системах, не входящих в прямой список — «может быть упущено», не строгая связь (§17.3)."""
    risk_base_ids = {e.risk_base_id for e in events if e.risk_base_id}
    if not risk_base_ids:
        return set()
    bases = list((await db.execute(select(RiskBase).where(RiskBase.id.in_(risk_base_ids)))).scalars().all())
    categories = {b.category for b in bases if b.category}
    own_keywords: set[str] = set()
    for b in bases:
        own_keywords |= _keywords(b.keywords)
    if not categories:
        return set()

    event_ids = [e.id for e in events]
    other_events = list((await db.execute(
        select(RiskEvent).where(
            RiskEvent.category.in_(categories),
            RiskEvent.id.notin_(event_ids) if event_ids else True,
            RiskEvent.system_id.is_not(None),
        )
    )).scalars().all())
    if not other_events:
        return set()

    other_base_ids = {e.risk_base_id for e in other_events if e.risk_base_id}
    other_bases = {
        b.id: b for b in (await db.execute(
            select(RiskBase).where(RiskBase.id.in_(other_base_ids))
        )).scalars().all()
    } if other_base_ids else {}

    system_ids = {e.system_id for e in other_events if e.system_id}
    system_names = {
        s.id: s.name for s in (await db.execute(
            select(System).where(System.id.in_(system_ids))
        )).scalars().all()
    } if system_ids else {}

    indirect: set[str] = set()
    for e in other_events:
        base = other_bases.get(e.risk_base_id)
        overlap = bool(own_keywords & _keywords(base.keywords)) if base else False
        if not overlap:
            continue
        name = system_names.get(e.system_id)
        if name and name not in direct:
            indirect.add(name)
    return indirect


async def compute_systemic_scope(db: AsyncSession, p: Proposal) -> tuple[int, str | None]:
    """Возвращает (число затронутых систем, текст LLM-пометки). Пометка — None, если косвенных
    признаков не найдено (не показываем оговорку, которой не о чем предупреждать).

    Число систем ВСЕГДА детерминированное (граф риск↔ТС↔риск-база, см. функции выше) — LLM
    только формулирует текст пометки вокруг уже посчитанного списка, заземлённый вызов не
    может назвать систему, которой нет в `indirect` (governance/llm/service.py:
    generate_systemic_scope_note, УК-46)."""
    events = await _linked_risk_events(db, p.id)
    direct = await _direct_systems(db, p, events)
    indirect = await _indirect_systems(db, events, direct)

    llm_note = None
    if indirect:
        from app.modules.llm import generate_systemic_scope_note
        llm_note = generate_systemic_scope_note(sorted(direct), sorted(indirect))
    return len(direct) + len(indirect), llm_note
