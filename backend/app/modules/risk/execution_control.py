"""
Двойной контроль исполнения мер (ТЗ v19 §17.2, УК-45).

Контроль и решение по мере — за QUALITY_MANAGER, как и раньше. Параллельно система сверяет
исполненные меры с техническими сбоями и сигнализирует о рассинхроне: мера отмечена исполненной,
а сбои той же природы продолжаются. Сигнал — не решение: он виден менеджеру по качеству на его
дашборде, решает человек.

Два уровня сигнала:
  • «связанный» — после исполнения меры зарегистрирован сбой, привязанный к риску этой меры
    (RiskEventIncident) или к самой мере (TechIncident.linked_measure_id). Факт, без интерпретации;
  • «похожий» — сбой той же ИС после исполнения, ни к какому риску не привязанный, но близкий по
    смыслу к тексту меры (сопоставление провайдером эмбеддингов risk/embeddings: лексический по
    умолчанию, модельные эмбеддинги — при подключении, без изменений здесь). Маппинг сбоя на меру,
    который человек мог не сделать вручную.
"""
from __future__ import annotations

import math
import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.governance import EXECUTION_DONE, Proposal
from app.modules.incidents import TechIncident
from app.modules.risk.embeddings import embed_text
from app.modules.risk.models import RiskEventIncident, RiskEventMeasure

KIND_LINKED = "linked"
KIND_SIMILAR = "similar"
SIMILARITY_THRESHOLD = 0.35


class _CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)


class MismatchIncidentOut(_CamelModel):
    id: uuid.UUID
    title: str
    occurred_at: datetime
    cost_total: float | None = None
    similarity: float | None = None


class ExecutionMismatchOut(_CamelModel):
    proposal_id: uuid.UUID
    title: str
    system: str
    owner: str | None = None
    executed_at: datetime | None = None
    kind: str
    incidents: list[MismatchIncidentOut]
    note: str


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0


def _measure_text(p: Proposal) -> str:
    return " ".join(filter(None, [p.risk_title, p.metric_name, p.characteristic, p.rationale, p.expectation]))


def _incident_text(i: TechIncident) -> str:
    return " ".join(filter(None, [i.title, i.description, i.root_cause]))


async def execution_mismatches(db: AsyncSession) -> list[ExecutionMismatchOut]:
    done = list((await db.execute(
        select(Proposal).where(Proposal.execution == EXECUTION_DONE, Proposal.executed_at.is_not(None))
    )).scalars().all())
    if not done:
        return []

    risks_by_measure: dict[uuid.UUID, set[uuid.UUID]] = {}
    for rid, pid in (await db.execute(
        select(RiskEventMeasure.risk_event_id, RiskEventMeasure.proposal_id)
        .where(RiskEventMeasure.proposal_id.in_([p.id for p in done]))
    )).all():
        risks_by_measure.setdefault(pid, set()).add(rid)
    incidents_by_risk: dict[uuid.UUID, set[uuid.UUID]] = {}
    for rid, iid in (await db.execute(select(RiskEventIncident.risk_event_id, RiskEventIncident.incident_id))).all():
        incidents_by_risk.setdefault(rid, set()).add(iid)
    linked_to_any_risk = {iid for ids in incidents_by_risk.values() for iid in ids}

    earliest = min(p.executed_at for p in done)
    incidents = list((await db.execute(
        select(TechIncident).where(TechIncident.occurred_at > earliest, TechIncident.parent_incident_id.is_(None))
    )).scalars().all())

    out: list[ExecutionMismatchOut] = []
    for p in done:
        after = [i for i in incidents if i.occurred_at > p.executed_at]
        risk_incident_ids = set().union(*(incidents_by_risk.get(r, set()) for r in risks_by_measure.get(p.id, set())))
        linked = [i for i in after if i.id in risk_incident_ids or i.linked_measure_id == p.id]
        title = p.risk_title or p.metric_name or p.system_name
        if linked:
            out.append(ExecutionMismatchOut(
                proposal_id=p.id, title=title, system=p.system_name, owner=p.owner,
                executed_at=p.executed_at, kind=KIND_LINKED,
                incidents=[MismatchIncidentOut(id=i.id, title=i.title, occurred_at=i.occurred_at,
                                               cost_total=float(i.cost_total) if i.cost_total is not None else None)
                           for i in sorted(linked, key=lambda x: x.occurred_at)],
                note=(f"Мера отмечена исполненной {p.executed_at:%d.%m.%Y}, но по её риску после этого "
                      f"зарегистрировано сбоев: {len(linked)}. Проверьте, устранена ли причина."),
            ))
            continue
        candidates = [i for i in after if i.system_name == p.system_name and i.id not in linked_to_any_risk]
        if not candidates:
            continue
        mvec = embed_text(_measure_text(p))
        similar = []
        for i in candidates:
            sim = round(_cosine(mvec, embed_text(_incident_text(i))), 3)
            if sim >= SIMILARITY_THRESHOLD:
                similar.append((sim, i))
        if similar:
            similar.sort(key=lambda x: x[0], reverse=True)
            out.append(ExecutionMismatchOut(
                proposal_id=p.id, title=title, system=p.system_name, owner=p.owner,
                executed_at=p.executed_at, kind=KIND_SIMILAR,
                incidents=[MismatchIncidentOut(id=i.id, title=i.title, occurred_at=i.occurred_at,
                                               cost_total=float(i.cost_total) if i.cost_total is not None else None,
                                               similarity=sim) for sim, i in similar],
                note=("После исполнения меры в той же ИС были сбои, похожие по описанию на то, что мера "
                      "должна была устранить. Сбои не привязаны к риску — сверьте и привяжите вручную."),
            ))
    out.sort(key=lambda m: (m.kind != KIND_LINKED, -len(m.incidents)))
    return out
