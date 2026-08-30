"""
Логика домена incidents (T-21): CRUD техсбоев + аналитика надёжности.

Аналитика — самостоятельный анализатор (не трогает расчётный движок качества): распределение по
первопричинам, MTTR (среднее время восстановления закрытых), топ нестабильных ИС, доля сбоев,
привнесённых релизом. Валидация категории/критичности — здесь (не покрыта схемой перечислением).
"""
from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.incidents.models import (
    CATEGORIES,
    CATEGORY_INFRASTRUCTURE,
    CATEGORY_LABELS,
    CATEGORY_NETWORK,
    CATEGORY_OTHER,
    CATEGORY_PERFORMANCE,
    CATEGORY_POWER,
    CATEGORY_RELEASE,
    CATEGORY_TO_CHARACTERISTIC,
    SEVERITIES,
    TechIncident,
)
from app.modules.incidents.schemas import (
    TtrStats,
    CategoryStat,
    IncidentAnalyticsOut,
    IncidentCategoriesOut,
    IncidentCategoryOption,
    IncidentImportResult,
    IncidentImportRow,
    SystemStat,
    TechIncidentCreate,
    TechIncidentUpdate,
)
from app.shared.exceptions import NotFoundError, ValidationError


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _validate(category: str | None, severity: str | None) -> None:
    if category is not None and category not in CATEGORIES:
        raise ValidationError(f"Недопустимая категория сбоя: {category}")
    if severity is not None and severity not in SEVERITIES:
        raise ValidationError(f"Недопустимая критичность: {severity}")


# T-36: обязательные поля разбора сбоя при РУЧНОМ вводе (source=manual). Для импорта/ITSM проверка
# мягкая (внешние данные неполны — недостающее дозаполняется при ручной доработке карточки).
_REQUIRED_MANUAL: dict[str, str] = {
    "root_cause": "корневая причина",
    "admission_cause": "причина допущения",
    "responsible_unit": "виновное направление производства",
    "preventive_measures": "меры по неповторению",
}


def _validate_manual_required(data: TechIncidentCreate) -> None:
    if (data.source or "manual") != "manual":
        return
    missing = [label for field, label in _REQUIRED_MANUAL.items() if not (getattr(data, field) or "").strip()]
    if missing:
        raise ValidationError("Не заполнены обязательные поля: " + ", ".join(missing))
    # T-37: первопричина «Другое» требует текст новой первопричины.
    if data.category == CATEGORY_OTHER and not (data.category_custom or "").strip():
        raise ValidationError("Для первопричины «Другое» укажите новую первопричину (categoryCustom)")


def _mttr_hours(inc: TechIncident) -> float | None:
    if inc.resolved_at is None or inc.occurred_at is None:
        return None
    return round((inc.resolved_at - inc.occurred_at).total_seconds() / 3600, 1)


async def list_incidents(
    db: AsyncSession, *, system: str | None = None, category: str | None = None,
    severity: str | None = None, status: str | None = None,
) -> list[TechIncident]:
    stmt = select(TechIncident)
    if system:
        stmt = stmt.where(TechIncident.system_name == system)
    if category:
        stmt = stmt.where(TechIncident.category == category)
    if severity:
        stmt = stmt.where(TechIncident.severity == severity)
    if status == "open":
        stmt = stmt.where(TechIncident.resolved_at.is_(None))
    elif status == "resolved":
        stmt = stmt.where(TechIncident.resolved_at.is_not(None))
    stmt = stmt.order_by(TechIncident.occurred_at.desc())
    return list((await db.execute(stmt)).scalars().all())


async def get_or_404(db: AsyncSession, iid: uuid.UUID) -> TechIncident:
    inc = await db.get(TechIncident, iid)
    if inc is None:
        raise NotFoundError("Технический сбой не найден")
    return inc


async def list_categories(db: AsyncSession) -> IncidentCategoriesOut:
    """Справочник первопричин (T-37): базовые коды + ранее введённые пользовательские (category=OTHER)."""
    base = [IncidentCategoryOption(code=c, label=CATEGORY_LABELS.get(c, c)) for c in CATEGORIES]
    stmt = select(TechIncident.category_custom).where(TechIncident.category_custom.is_not(None)).distinct()
    custom = sorted({v.strip() for v in (await db.execute(stmt)).scalars().all() if v and v.strip()})
    return IncidentCategoriesOut(base=base, custom=custom)


# ─── Импорт из внешних источников (T-43): нормализация значений нестандартизированного файла ───
# Синонимы первопричины (значение файла → код). Базовые коды/метки + распространённые термины ITSM.
_CATEGORY_BY_ALIAS: dict[str, str] = {
    **{code.lower(): code for code in CATEGORIES},
    **{CATEGORY_LABELS[code].lower(): code for code in CATEGORIES if code in CATEGORY_LABELS},
    "release": CATEGORY_RELEASE, "привнесено релизом": CATEGORY_RELEASE, "регрессия": CATEGORY_RELEASE,
    "infrastructure": CATEGORY_INFRASTRUCTURE, "инфраструктура": CATEGORY_INFRASTRUCTURE, "схд": CATEGORY_INFRASTRUCTURE,
    "performance": CATEGORY_PERFORMANCE, "производительность": CATEGORY_PERFORMANCE, "деградация": CATEGORY_PERFORMANCE,
    "network": CATEGORY_NETWORK, "сеть": CATEGORY_NETWORK, "dns": CATEGORY_NETWORK,
    "power": CATEGORY_POWER, "электроснабжение": CATEGORY_POWER, "питание": CATEGORY_POWER, "ибп": CATEGORY_POWER,
}
_SEVERITY_BY_ALIAS: dict[str, str] = {"p1": "critical", "p2": "high", "p3": "medium", "p4": "low"}
_DATE_FORMATS = ("%d.%m.%Y %H:%M", "%d.%m.%Y", "%Y-%m-%d %H:%M", "%Y-%m-%d")


def _map_category(raw: str | None) -> tuple[str, str | None]:
    v = (raw or "").strip()
    if not v:
        return CATEGORY_OTHER, "не указана"
    code = _CATEGORY_BY_ALIAS.get(v.lower())
    return (code, None) if code else (CATEGORY_OTHER, v)


def _map_severity(raw: str | None) -> str:
    v = (raw or "").strip().lower()
    if v in SEVERITIES:
        return v
    return _SEVERITY_BY_ALIAS.get(v, "medium")


def _parse_dt(raw: str | None) -> datetime | None:
    v = (raw or "").strip()
    if not v:
        return None
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(v, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    try:
        d = datetime.fromisoformat(v.replace("Z", "+00:00"))
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


async def import_incidents(db: AsyncSession, rows: list[IncidentImportRow], username: str) -> IncidentImportResult:
    """Импорт распарсенных строк ТС из внешнего ITSM/ЕХД/DWH (source=import). Нормализует первопричину/
    критичность/даты, дедуплицирует по (система+описание+дата) против БД и внутри пакета. Обязательность
    полей разбора — мягкая (внешние данные неполны); недостающая корректная дата возникновения → пропуск.
    """
    existing = {(r.system_name, r.title, r.occurred_at.isoformat()) for r in await list_incidents(db)}
    seen: set[tuple[str, str, str]] = set()
    created = 0
    skipped = 0
    errors: list[str] = []
    for i, row in enumerate(rows, 1):
        system = (row.system_name or "").strip()
        title = (row.title or "").strip()
        occ = _parse_dt(row.occurred_at)
        if not system or not title or occ is None:
            skipped += 1
            errors.append(f"Строка {i}: пропущена — нет системы/описания/корректной даты возникновения")
            continue
        key = (system, title, occ.isoformat())
        if key in existing or key in seen:
            skipped += 1
            errors.append(f"Строка {i}: дубль — {system} · {title}")
            continue
        seen.add(key)
        code, custom = _map_category(row.category)
        db.add(TechIncident(
            system_name=system, title=title, category=code, category_custom=custom,
            severity=_map_severity(row.severity), occurred_at=occ, resolved_at=_parse_dt(row.resolved_at),
            root_cause=row.root_cause, admission_cause=row.admission_cause,
            responsible_unit=row.responsible_unit, preventive_measures=row.preventive_measures,
            release_ref=row.release_ref, source="import", created_by=username,
        ))
        created += 1
    await db.commit()
    return IncidentImportResult(created=created, skipped=skipped, errors=errors[:50])


async def create(db: AsyncSession, data: TechIncidentCreate, username: str) -> TechIncident:
    _validate(data.category, data.severity)
    _validate_manual_required(data)
    inc = TechIncident(**data.model_dump(exclude_none=False), created_by=username)
    db.add(inc)
    await db.commit()
    await db.refresh(inc)
    return inc


async def update(db: AsyncSession, inc: TechIncident, data: TechIncidentUpdate) -> TechIncident:
    patch = data.model_dump(exclude_unset=True)
    _validate(patch.get("category"), patch.get("severity"))
    for field, value in patch.items():
        setattr(inc, field, value)
    await db.commit()
    await db.refresh(inc)
    return inc


async def resolve(db: AsyncSession, inc: TechIncident, resolved_at: datetime | None) -> TechIncident:
    inc.resolved_at = resolved_at or _now()
    await db.commit()
    await db.refresh(inc)
    return inc


async def triggering_characteristics(
    db: AsyncSession, *, system: str | None = None,
) -> dict[str, list[tuple[str, int]]]:
    """Риск-триггеры (T-16): по техсбоям → характеристика ISO 25010 → [(категория, число сбоев)].

    Проактивный сигнал «недопущения техсбоя»: частые сбои категории подсвечивают риски по
    связанной характеристике. Возвращает характеристику → перечень триггерящих категорий с числом.
    """
    rows = await list_incidents(db, system=system)
    cat_count: dict[str, int] = defaultdict(int)
    for r in rows:
        cat_count[r.category] += 1
    char_triggers: dict[str, list[tuple[str, int]]] = defaultdict(list)
    for cat, cnt in sorted(cat_count.items(), key=lambda kv: kv[1], reverse=True):
        char = CATEGORY_TO_CHARACTERISTIC.get(cat)
        if char:
            char_triggers[char].append((CATEGORY_LABELS.get(cat, cat), cnt))
    return dict(char_triggers)



def _avg(values: list[float]) -> float | None:
    """Среднее по непустой выборке, иначе None (в UI это «нет данных», а не ноль)."""
    return round(sum(values) / len(values), 1) if values else None


def _ttr_stats(rows: list[TechIncident]) -> TtrStats:
    """Тайминги устранения (ДЕФ-31, БТ-272).

    Поля t_reaction_min / t_resolution_min / t_target_min и root_cause_fixed_at заводились
    при RE-05, но наружу не отдавались — виджета TTR на дашборде не было.
    Считаем только по заполненным значениям: пустые не приравниваем к нулю, иначе среднее
    занижалось бы тем сильнее, чем хуже заполнены данные.
    """
    reaction = [float(r.t_reaction_min) for r in rows if r.t_reaction_min is not None]
    resolution = [float(r.t_resolution_min) for r in rows if r.t_resolution_min is not None]
    target = [float(r.t_target_min) for r in rows if r.t_target_min is not None]

    lags: list[float] = []
    for r in rows:
        if r.root_cause_fixed_at is not None and r.resolved_at is not None:
            delta = (r.root_cause_fixed_at - r.resolved_at).total_seconds() / 3600
            if delta >= 0:
                lags.append(delta)

    measured = sum(
        1 for r in rows
        if r.t_reaction_min is not None or r.t_resolution_min is not None or r.t_target_min is not None
    )
    return TtrStats(
        avg_reaction_min=_avg(reaction),
        avg_resolution_min=_avg(resolution),
        avg_target_min=_avg(target),
        avg_root_cause_lag_hours=_avg(lags),
        root_cause_fixed_count=sum(1 for r in rows if r.root_cause_fixed_at is not None),
        measured_count=measured,
    )

async def analytics(db: AsyncSession, *, system: str | None = None) -> IncidentAnalyticsOut:
    rows = await list_incidents(db, system=system)
    total = len(rows)
    open_rows = [r for r in rows if r.resolved_at is None]
    resolved_rows = [r for r in rows if r.resolved_at is not None]

    all_mttr = [m for m in (_mttr_hours(r) for r in resolved_rows) if m is not None]
    avg_mttr = round(sum(all_mttr) / len(all_mttr), 1) if all_mttr else None

    ttr = _ttr_stats(rows)

    # Разбивка по категориям (все известные категории — стабильный порядок, включая нулевые).
    cat_rows: dict[str, list[TechIncident]] = defaultdict(list)
    for r in rows:
        cat_rows[r.category].append(r)
    by_category: list[CategoryStat] = []
    for cat in CATEGORIES:
        items = cat_rows.get(cat, [])
        if not items:
            continue
        mttrs = [m for m in (_mttr_hours(r) for r in items if r.resolved_at is not None) if m is not None]
        by_category.append(CategoryStat(
            category=cat,
            count=len(items),
            share=round(len(items) / total * 100, 1) if total else 0.0,
            open_count=sum(1 for r in items if r.resolved_at is None),
            avg_mttr_hours=round(sum(mttrs) / len(mttrs), 1) if mttrs else None,
        ))
    by_category.sort(key=lambda c: c.count, reverse=True)

    # Топ нестабильных ИС по числу сбоев.
    sys_rows: dict[str, list[TechIncident]] = defaultdict(list)
    for r in rows:
        sys_rows[r.system_name].append(r)
    top_systems = sorted(
        (SystemStat(
            system_name=name,
            count=len(items),
            open_count=sum(1 for r in items if r.resolved_at is None),
        ) for name, items in sys_rows.items()),
        key=lambda s: s.count, reverse=True,
    )[:10]

    release_count = len(cat_rows.get(CATEGORY_RELEASE, []))

    # ТЗ v21 (КП-30): MTBF/доступность за окно наблюдения (от первого сбоя выборки до сейчас).
    # Приблизительно (не строгий SLA-расчёт по договору), но не выдумано: при нуле сбоев —
    # None, а не фиктивные 100% (§7.3 честной пустоты).
    window_hours = mtbf_hours = availability_pct = None
    if rows:
        earliest = min(r.occurred_at for r in rows)
        now = datetime.now(timezone.utc)
        occurred = earliest if earliest.tzinfo else earliest.replace(tzinfo=timezone.utc)
        window_hours = max((now - occurred).total_seconds() / 3600, 1.0)
        mtbf_hours = round(window_hours / total, 1)
        downtime_hours = sum(float(r.downtime_minutes or 0) for r in rows) / 60
        availability_pct = round(max(0.0, min(100.0, 100 * (1 - downtime_hours / window_hours))), 2)

    return IncidentAnalyticsOut(
        total=total,
        open_count=len(open_rows),
        resolved_count=len(resolved_rows),
        avg_mttr_hours=avg_mttr,
        ttr=ttr,
        release_induced_share=round(release_count / total * 100, 1) if total else 0.0,
        by_category=by_category,
        top_systems=top_systems,
        window_hours=round(window_hours, 1) if window_hours is not None else None,
        mtbf_hours=mtbf_hours,
        availability_pct=availability_pct,
    )
