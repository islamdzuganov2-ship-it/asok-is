"""
Веса подхарактеристик — гибрид с переходом (BL-007, RE-15, §4.3 ТЗ).

Проблема: чисто экспертные веса не защищаются перед CFO, чисто риск-ориентированные обнуляют редкие
катастрофические классы (защищённость реализуется раз — и фатально). Решение — гибрид, где доля
фактики растёт ПО ДОСТАТОЧНОСТИ ДАННЫХ, а не по календарю:

    α(i) = max(α_min, N₀/(N₀+N(i)))
    вес(i) = α(i)·профиль(i, класс ИС) + (1−α(i))·фактика(i, доля в ALE)

- N(i) — число дедуплицированных ТС, отнесённых к подхарактеристике i (по risk_event↔ТС);
- профиль — нормативный вес по классу критичности (Mission/Business/Support);
- фактика — доля подхарактеристики в суммарном ALE портфеля.

α считается ОТДЕЛЬНО по каждой подхарактеристике: быстро набирающая статистику надёжность не должна
«протащить» за собой защищённость без данных. `α_min` (0.3) не даёт риск-весам обнулить редкие классы.

Самодостаточный модуль: НЕ монтируется в роутер (по договорённости — без правки общих файлов). Читает
константу QUALITY_MODEL и МОДЕЛИ risk напрямую (не фасады) — как dashboard_service, чтобы econ остался
нижним слоем. Обёртка-эндпойнт добавляется отдельным шагом при согласовании.
"""
from __future__ import annotations

from collections import defaultdict

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.econ.service import config_value
from app.modules.quality.quality_model import QUALITY_MODEL
from app.modules.risk.models import (
    RISK_EVENT_ACTIVE,
    RiskEvent,
    RiskEventIncident,
    RiskEventSubchar,
)

# Классы критичности (значения совпадают с systems.CriticalityClass.name).
MISSION_CRITICAL = "MISSION_CRITICAL"
BUSINESS_CRITICAL = "BUSINESS_CRITICAL"
SUPPORT = "SUPPORT"  # synonym для BUSINESS_OPERATIONAL (ГОСТ-класс «поддерживающая»)
_CRIT_ALIASES = {
    "BUSINESS_OPERATIONAL": SUPPORT,
    "MISSION CRITICAL": MISSION_CRITICAL,
    "BUSINESS CRITICAL": BUSINESS_CRITICAL,
    "BUSINESS OPERATIONAL": SUPPORT,
}

# Нормативные профили весов по КЛАССУ ИС на уровне характеристик (сумма = 1.0). Внутри характеристики
# профиль делится поровну между её подхарактеристиками (§4.3: три профиля — Mission/Business/Support).
PROFILES: dict[str, dict[str, float]] = {
    # Mission Critical — акцент на надёжность, защищённость, производительность.
    MISSION_CRITICAL: {
        "Надёжность": 0.22, "Защищённость": 0.20, "Производительность": 0.16,
        "Функциональная пригодность": 0.14, "Сопровождаемость": 0.10, "Совместимость": 0.08,
        "Удобство использования": 0.06, "Переносимость": 0.04,
    },
    # Business Critical — баланс + сопровождаемость.
    BUSINESS_CRITICAL: {
        "Функциональная пригодность": 0.16, "Надёжность": 0.16, "Сопровождаемость": 0.16,
        "Производительность": 0.13, "Защищённость": 0.13, "Удобство использования": 0.10,
        "Совместимость": 0.09, "Переносимость": 0.07,
    },
    # Support — акцент на сопровождаемость, переносимость, стоимость владения.
    SUPPORT: {
        "Сопровождаемость": 0.22, "Переносимость": 0.16, "Функциональная пригодность": 0.14,
        "Удобство использования": 0.14, "Надёжность": 0.12, "Совместимость": 0.10,
        "Производительность": 0.08, "Защищённость": 0.04,
    },
}

DEFAULT_ALPHA_MIN = 0.3
DEFAULT_N0 = 12


# ─────────────────────────── Чистые функции (тестируемы без БД) ───────────────────────────

def alpha_for(n: int, n0: int = DEFAULT_N0, alpha_min: float = DEFAULT_ALPHA_MIN) -> float:
    """α(i) = max(α_min, N₀/(N₀+N)). N=0 → 1.0 (только профиль); растёт N → доминирует фактика,
    но профиль сохраняет минимум α_min (защита защищённости от обнуления, §4.3)."""
    if n0 <= 0:
        return alpha_min
    return round(max(alpha_min, n0 / (n0 + max(0, n))), 4)


def hybrid_weight(alpha: float, profile: float, factual: float) -> float:
    """вес(i) = α·профиль + (1−α)·фактика (до нормировки)."""
    return alpha * profile + (1.0 - alpha) * factual


def profile_by_subchar(criticality: str) -> dict[tuple[str, str], float]:
    """Нормативный профиль на уровне подхарактеристик: вес характеристики делится поровну между её
    подхарактеристиками. Сумма по всем подхарактеристикам = 1.0."""
    key = _CRIT_ALIASES.get(criticality, criticality)
    chars = PROFILES.get(key, PROFILES[BUSINESS_CRITICAL])
    out: dict[tuple[str, str], float] = {}
    for characteristic, subs in QUALITY_MODEL:
        w = chars.get(characteristic, 0.0)
        per = w / len(subs) if subs else 0.0
        for sub, _formula in subs:
            out[(characteristic, sub)] = per
    return out


def _normalize(d: dict) -> dict:
    total = sum(d.values())
    if total <= 0:
        return {k: 0.0 for k in d}
    return {k: v / total for k, v in d.items()}


# ─────────────────────────── Результат ───────────────────────────

class _CamelModel(BaseModel):
    """camelCase наружу — единый контракт с фронтом (как в остальных DTO контура)."""
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)


class SubcharWeight(_CamelModel):
    characteristic: str
    subcharacteristic: str
    n_incidents: int          # N(i) — дедуп. ТС, отнесённые к подхарактеристике
    alpha: float              # доля профиля (1.0 — данных нет; α_min — данных много)
    profile_weight: float     # нормативный вклад
    factual_weight: float     # риск-ориентированный вклад (доля в ALE)
    final_weight: float       # итог гибрида, нормирован (Σ = 1)


class WeightsResult(_CamelModel):
    criticality: str
    alpha_min: float
    n0: int
    total_ale: float
    dominant_source: str      # 'profile' | 'factual' | 'mixed' — что доминирует в среднем
    weights: list[SubcharWeight]


async def compute_subchar_weights(db: AsyncSession, *, criticality: str = BUSINESS_CRITICAL) -> WeightsResult:
    """Гибридные веса подхарактеристик по портфелю (§4.3). Профиль — по классу ИС; фактика и N(i) —
    из числового контура рисков (risk_event↔подхарактеристика↔ТС)."""
    alpha_min = float(await config_value(db, "weights_alpha_min", DEFAULT_ALPHA_MIN) or DEFAULT_ALPHA_MIN)
    n0 = int(await config_value(db, "weights_n0", DEFAULT_N0) or DEFAULT_N0)

    events = list((await db.execute(
        select(RiskEvent).where(RiskEvent.status == RISK_EVENT_ACTIVE)
    )).scalars().all())
    subchar_links = list((await db.execute(select(RiskEventSubchar))).scalars().all())
    incident_links = list((await db.execute(select(RiskEventIncident))).scalars().all())

    # Индексы: событие → подхарактеристики; событие → инциденты; подхарактеристика → события.
    subs_by_event: dict = defaultdict(list)   # event_id → [(characteristic, sub)]
    events_by_sub: dict = defaultdict(set)     # (characteristic, sub) → {event_id}
    for lk in subchar_links:
        key = (lk.characteristic, lk.subcharacteristic)
        subs_by_event[lk.risk_event_id].append(key)
        events_by_sub[key].add(lk.risk_event_id)
    incidents_by_event: dict = defaultdict(set)  # event_id → {incident_id}
    for lk in incident_links:
        incidents_by_event[lk.risk_event_id].add(lk.incident_id)

    # Фактика: ALE события делится поровну между его подхарактеристиками, суммируется по подхар.
    ale_by_sub: dict = defaultdict(float)
    for e in events:
        keys = subs_by_event.get(e.id, [])
        if not keys:
            continue
        share = float(e.ale_avg or 0) / len(keys)
        for key in keys:
            ale_by_sub[key] += share
    total_ale = round(sum(ale_by_sub.values()), 2)
    factual = _normalize(dict(ale_by_sub)) if total_ale > 0 else {}

    # N(i): число ДЕДУП. ТС (distinct incident_id) по событиям, привязанным к подхарактеристике.
    n_by_sub: dict = {}
    for key, ev_ids in events_by_sub.items():
        inc: set = set()
        for eid in ev_ids:
            inc |= incidents_by_event.get(eid, set())
        n_by_sub[key] = len(inc)

    profile = profile_by_subchar(criticality)

    # Гибрид по каждой подхарактеристике модели (все 31), затем нормировка Σ=1.
    raw: dict = {}
    meta: dict = {}
    for key, prof_w in profile.items():
        n = n_by_sub.get(key, 0)
        a = alpha_for(n, n0, alpha_min)
        fact_w = factual.get(key, 0.0)
        raw[key] = hybrid_weight(a, prof_w, fact_w)
        meta[key] = (n, a, prof_w, fact_w)
    final = _normalize(raw)

    weights = [
        SubcharWeight(
            characteristic=c, subcharacteristic=s,
            n_incidents=meta[(c, s)][0], alpha=round(meta[(c, s)][1], 4),
            profile_weight=round(meta[(c, s)][2], 4), factual_weight=round(meta[(c, s)][3], 4),
            final_weight=round(final[(c, s)], 4),
        )
        for (c, s) in profile
    ]
    weights.sort(key=lambda w: w.final_weight, reverse=True)

    avg_alpha = sum(m[1] for m in meta.values()) / len(meta) if meta else 1.0
    dominant = "profile" if avg_alpha >= 0.66 else "factual" if avg_alpha <= 0.4 else "mixed"

    return WeightsResult(
        criticality=_CRIT_ALIASES.get(criticality, criticality),
        alpha_min=alpha_min, n0=n0, total_ale=total_ale,
        dominant_source=dominant, weights=weights,
    )
