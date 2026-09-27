"""
Экономика техсбоя (BL-007): ввод аналитиком (RE-05), деградация и правило «деградация → простой»
(RE-06), учёт пакета часов вендора (RE-03), пересчёт C_ТС движком econ (RE-07).

До этого модуля экономические поля карточки ТС существовали в БД, но заполнить их было нечем:
API их не принимал, наполняли только демо-сиды. Аналитик не мог ни ввести трудозатраты по линиям,
ни отметить деградацию, а C_ТС реального сбоя не считался.

Правило конвертации (§2.2): деградация с K ≥ порога, длящаяся не меньше N минут, учитывается как
простой для SLA и отчётности о доступности. Пороги — EconConfig `degradation_downtime`
(по умолчанию K ≥ 0,7 и 15 минут), а не код.
"""
from __future__ import annotations

from datetime import timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.econ import (
    DEGRADATION_DOWNTIME_K,
    DEGRADATION_DOWNTIME_MINUTES,
    compute_incident_cost,
    config_value,
    degradation_counts_as_downtime,
    k_impact_for_degradation,
)
from app.modules.incidents.models import (
    DEGRADATION_TYPES,
    INCIDENT_DEGRADATION,
    INCIDENT_TYPES,
    TechIncident,
)
from app.modules.incidents.schemas import TechIncidentEconomicsIn, TechIncidentEconomicsOut
from app.shared.exceptions import ValidationError

LINES = ("L1", "L2", "L3")
_LINE_ATTR = {"L1": "labor_l1_hours", "L2": "labor_l2_hours", "L3": "labor_l3_hours"}


def _validate(data: TechIncidentEconomicsIn) -> None:
    if data.incident_type is not None and data.incident_type not in INCIDENT_TYPES:
        raise ValidationError(f"Недопустимый тип события: {data.incident_type}")
    if data.degradation_type is not None and data.degradation_type not in DEGRADATION_TYPES:
        raise ValidationError(f"Недопустимый тип деградации: {data.degradation_type}")
    if data.k_impact is not None and not 0 <= data.k_impact <= 1:
        raise ValidationError("K влияния — доля от 0 до 1")
    for line in data.labor_vendor_lines or []:
        if line not in LINES:
            raise ValidationError(f"Неизвестная линия сопровождения: {line}")
    for field in ("downtime_minutes", "labor_l1_hours", "labor_l2_hours", "labor_l3_hours",
                  "t_reaction_min", "t_resolution_min", "t_target_min"):
        value = getattr(data, field)
        if value is not None and value < 0:
            raise ValidationError(f"Отрицательное значение: {field}")


def counts_as_downtime(inc: TechIncident, k_threshold: float, min_minutes: float) -> bool | None:
    """Считается ли событие простоем для SLA/доступности. None — данных для правила нет."""
    if inc.incident_type != INCIDENT_DEGRADATION:
        return True
    if inc.k_impact is None or inc.downtime_minutes is None:
        return None
    return degradation_counts_as_downtime(
        float(inc.k_impact), float(inc.downtime_minutes), k_threshold, min_minutes,
    )


async def degradation_thresholds(db: AsyncSession) -> tuple[float, float]:
    cfg = await config_value(db, "degradation_downtime", None) or {}
    return (float(cfg.get("k", DEGRADATION_DOWNTIME_K)),
            float(cfg.get("minutes", DEGRADATION_DOWNTIME_MINUTES)))


async def _vendor_hours_used(db: AsyncSession, inc: TechIncident) -> dict[str, float]:
    """Часы пакета вендора, уже израсходованные в календарном месяце сбоя по той же ИС — до него.

    Пакет часов у вендора месячный (§2.4): 10-й час пакета оплачен абонентской платой, 11-й — уже по
    сверхлимитному тарифу. Без этого учёта каждый сбой считался бы «первым в месяце» и сверхлимит
    не проявлялся бы никогда.
    """
    vendor_lines = set(inc.labor_vendor_lines or [])
    if not vendor_lines or inc.occurred_at is None:
        return {}
    occ = inc.occurred_at if inc.occurred_at.tzinfo else inc.occurred_at.replace(tzinfo=timezone.utc)
    month_start = occ.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    q = select(TechIncident).where(
        TechIncident.id != inc.id,
        TechIncident.occurred_at >= month_start,
        TechIncident.occurred_at < occ,
    )
    if inc.system_id is not None:
        q = q.where(TechIncident.system_id == inc.system_id)
    else:
        q = q.where(TechIncident.system_name == inc.system_name)
    used: dict[str, float] = {}
    for other in (await db.execute(q)).scalars().all():
        for line in set(other.labor_vendor_lines or []) & vendor_lines:
            hours = getattr(other, _LINE_ATTR[line]) or 0
            used[line] = used.get(line, 0.0) + float(hours)
    return used


async def recompute(db: AsyncSession, inc: TechIncident) -> TechIncident:
    """K по типу деградации (если есть входы), правило «→ простой», C_ТС с разложением."""
    k_source = "manual" if inc.k_impact is not None else "default"
    if inc.incident_type == INCIDENT_DEGRADATION:
        computed = k_impact_for_degradation(inc.degradation_type, inc.degradation_inputs)
        if computed is not None:
            inc.k_impact = computed
            k_source = "computed"
    k_thr, min_minutes = await degradation_thresholds(db)
    inc.counts_as_downtime = counts_as_downtime(inc, k_thr, min_minutes)
    await compute_incident_cost(db, inc, vendor_hours_used=await _vendor_hours_used(db, inc))
    breakdown = dict(inc.cost_breakdown or {})
    breakdown["k_source"] = k_source
    inc.cost_breakdown = breakdown
    return inc


async def update_economics(db: AsyncSession, inc: TechIncident, data: TechIncidentEconomicsIn) -> TechIncident:
    _validate(data)
    patch = data.model_dump(exclude_unset=True)
    for field, value in patch.items():
        setattr(inc, field, value)
    if inc.incident_type != INCIDENT_DEGRADATION:
        # Полный простой: деградационные входы не применимы (иначе K «из прошлого» тянулся бы).
        inc.degradation_type = None
        inc.degradation_inputs = None
    await recompute(db, inc)
    await db.commit()
    await db.refresh(inc)
    return inc


def economics_out(inc: TechIncident) -> TechIncidentEconomicsOut:
    return TechIncidentEconomicsOut.model_validate(inc)

