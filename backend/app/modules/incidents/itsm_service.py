"""
Загрузка выгрузки ITSM в реестр техсбоев (BL-007, задел фазы I: RE-23…RE-27).

Шаги импорта: разбор файла адаптером (infrastructure.integrations.itsm) → аудит качества полей →
привязка к ИС по алиасам/имени/группе (RE-25) → корреляция дублей (RE-26) → трудозатраты из
журнала переназначений (RE-24) → поправки времени по APM, если калибровка сохранена (RE-27) →
upsert по номеру тикета (source='itsm'), пересчёт C_ТС.

Повторная загрузка той же выгрузки не плодит дубли: ключ — external_id.
"""
from __future__ import annotations

import uuid
from dataclasses import asdict

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.integrations.itsm import audit_quality, parse_export, to_record
from app.modules.econ import config_value, set_config
from app.modules.incidents import itsm
from app.modules.incidents.economics_service import recompute
from app.modules.incidents.models import (
    CATEGORY_OTHER,
    ItsmGroupMapping,
    SystemAlias,
    TechIncident,
)
from app.modules.systems import System
from app.shared.exceptions import ConflictError, ValidationError

_SEVERITY = {"1": "critical", "2": "high", "3": "medium", "4": "low", "5": "low",
             "critical": "critical", "high": "high", "medium": "medium", "low": "low"}


def _severity(raw: str | None) -> str:
    key = (raw or "").strip().lower()
    key = key[0] if key[:1].isdigit() else key
    return _SEVERITY.get(key, "medium")


async def _lookup_tables(db: AsyncSession) -> tuple[dict, dict, dict, dict]:
    systems = (await db.execute(select(System.id, System.name))).all()
    names = {itsm.normalize_name(n): sid for sid, n in systems}
    display = {sid: n for sid, n in systems}
    aliases = {a.alias_norm: a.system_id for a in (await db.execute(select(SystemAlias))).scalars()}
    groups = {itsm.normalize_name(g.group_name): g.system_id
              for g in (await db.execute(select(ItsmGroupMapping))).scalars()}
    return names, aliases, groups, display


async def _apm_correction(db: AsyncSession) -> itsm.ApmCorrection | None:
    raw = await config_value(db, "itsm_apm_correction", None)
    if not raw:
        return None
    return itsm.ApmCorrection(start_lag_min=float(raw.get("start_lag_min", 0)),
                              recovery_lag_min=float(raw.get("recovery_lag_min", 0)),
                              degradation_share=float(raw.get("degradation_share", 0)),
                              samples=int(raw.get("samples", 0)))


async def quality_report(content: bytes, fmt: str) -> dict:
    return audit_quality(parse_export(content, fmt))


async def import_export(db: AsyncSession, content: bytes, fmt: str, username: str) -> dict:
    if fmt not in ("csv", "json"):
        raise ValidationError("Формат выгрузки ITSM: csv или json")
    rows = parse_export(content, fmt)
    records = [r for r in (to_record(x) for x in rows) if r is not None]
    names, aliases, groups, display = await _lookup_tables(db)
    k_util = float(await config_value(db, "itsm_k_util", itsm.K_UTIL_DEFAULT) or itsm.K_UTIL_DEFAULT)
    apm = await _apm_correction(db)

    resolved: dict[str, itsm.SystemResolution] = {}
    refs: list[itsm.TicketRef] = []
    unresolved: set[str] = set()
    for r in records:
        res = itsm.resolve_system(r.ci_name, r.assignment_group, aliases, names, groups)
        resolved[r.external_id] = res
        opened = itsm.parse_ts(r.opened_at)
        if res.system_id is None:
            unresolved.add(r.ci_name or r.assignment_group or "—")
        if opened is not None:
            refs.append(itsm.TicketRef(r.external_id, str(res.system_id or itsm.normalize_name(r.ci_name)),
                                       opened, r.parent_ref))
    parents = itsm.correlate(refs)

    existing = {i.external_id: i for i in (await db.execute(
        select(TechIncident).where(TechIncident.external_id.in_([r.external_id for r in records]))
    )).scalars()} if records else {}

    created = updated = skipped = 0
    by_ref: dict[str, TechIncident] = {}
    for r in records:
        opened, closed = itsm.parse_ts(r.opened_at), itsm.parse_ts(r.resolved_at)
        if opened is None:
            skipped += 1
            continue
        downtime = None
        if apm is not None:
            opened, closed, downtime = itsm.apply_apm_correction(opened, closed, apm)
        elif closed is not None:
            downtime = round((closed - opened).total_seconds() / 60, 2)
        res = resolved[r.external_id]
        inc = existing.get(r.external_id)
        if inc is None:
            inc = TechIncident(external_id=r.external_id, source="itsm", created_by=username,
                               category=CATEGORY_OTHER, category_custom=r.category)
            db.add(inc)
            created += 1
        else:
            updated += 1
        inc.system_id = res.system_id
        inc.system_name = display.get(res.system_id) or (r.ci_name or r.assignment_group or "не сопоставлена")
        inc.title = (r.title or f"Тикет {r.external_id}")[:255]
        inc.severity = _severity(r.severity)
        inc.occurred_at, inc.resolved_at = opened, closed
        if downtime is not None:
            inc.downtime_minutes = downtime
        if r.reassignments:
            labor = itsm.labor_from_reassignments(list(r.reassignments), r.resolved_at, k_util)
            inc.labor_l1_hours = labor.get("L1")
            inc.labor_l2_hours = labor.get("L2")
            inc.labor_l3_hours = labor.get("L3")
            inc.labor_source = "reassignment_log"
        by_ref[r.external_id] = inc
    await db.flush()

    children = 0
    for child_ref, parent_ref in parents.items():
        child, parent = by_ref.get(child_ref), by_ref.get(parent_ref)
        if child is not None and parent is not None and child is not parent:
            child.parent_incident_id = parent.id
            children += 1
    for inc in by_ref.values():
        await recompute(db, inc)
    await db.commit()
    return {
        "created": created, "updated": updated, "skipped": skipped,
        "children_linked": children,
        "unresolved_systems": sorted(unresolved),
        "apm_correction_applied": apm is not None,
        "k_util": k_util,
        "quality": audit_quality(rows),
    }


# ── RE-25: справочники сопоставления ──

async def list_group_mappings(db: AsyncSession) -> list[ItsmGroupMapping]:
    return list((await db.execute(select(ItsmGroupMapping).order_by(ItsmGroupMapping.group_name))).scalars())


async def upsert_group_mapping(db: AsyncSession, group_name: str, system_id: uuid.UUID, note: str | None) -> ItsmGroupMapping:
    if await db.get(System, system_id) is None:
        raise ValidationError("ИС не найдена")
    row = (await db.execute(select(ItsmGroupMapping).where(ItsmGroupMapping.group_name == group_name.strip()))).scalar_one_or_none()
    if row is None:
        row = ItsmGroupMapping(group_name=group_name.strip(), system_id=system_id, note=note)
        db.add(row)
    else:
        row.system_id, row.note = system_id, note
    await db.commit()
    await db.refresh(row)
    return row


async def list_aliases(db: AsyncSession) -> list[SystemAlias]:
    return list((await db.execute(select(SystemAlias).order_by(SystemAlias.alias))).scalars())


async def add_alias(db: AsyncSession, alias: str, system_id: uuid.UUID) -> SystemAlias:
    if await db.get(System, system_id) is None:
        raise ValidationError("ИС не найдена")
    norm = itsm.normalize_name(alias)
    if not norm:
        raise ValidationError("Пустой алиас")
    dup = (await db.execute(select(SystemAlias).where(SystemAlias.alias_norm == norm))).scalar_one_or_none()
    if dup is not None:
        raise ConflictError(f"Алиас «{alias}» уже закреплён за другой ИС")
    row = SystemAlias(alias=alias.strip(), alias_norm=norm, system_id=system_id)
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


# ── RE-24 / RE-27: калибровки, сохраняются в EconConfig ──

async def save_k_util(db: AsyncSession, samples: list[tuple[float, float]], apply: bool) -> dict:
    cal = itsm.calibrate_k_util(samples)
    if apply:
        if not cal.reliable:
            raise ValidationError(f"Калибровка на {cal.samples} тикетах ненадёжна: нужно не меньше "
                                  f"{itsm.K_UTIL_MIN_SAMPLES}")
        await set_config(db, "itsm_k_util", cal.k_util,
                         f"K_утил (RE-24): калибровка на {cal.samples} тикетах, MAPE {cal.mape_pct}%")
    return asdict(cal) | {"applied": apply}


async def save_apm_correction(db: AsyncSession, pairs: list, apply: bool) -> dict:
    corr = itsm.apm_calibration(pairs)
    if apply:
        await set_config(db, "itsm_apm_correction", {
            "start_lag_min": corr.start_lag_min, "recovery_lag_min": corr.recovery_lag_min,
            "degradation_share": corr.degradation_share, "samples": corr.samples,
        }, "Поправки ITSM по APM (RE-27): применяются при каждой загрузке выгрузки")
    return asdict(corr) | {"applied": apply}
