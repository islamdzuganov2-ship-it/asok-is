"""
Экономический движок риск-экономического контура (BL-007, RE-07/09/12/13) — ЧИСТЫЕ функции.

Здесь нет БД и I/O: только формулы §2–§3 ТЗ. Это сделано намеренно — движок тестируется в изоляции
(tests/test_econ_engine.py), а сервис-слой (econ/service.py) достаёт данные из справочников и
подставляет их сюда. Значения по умолчанию (ставка дисконта, горизонт, пороги) переопределяются
через EconConfig; здесь — константы-заглушки до ответов заказчика (открытые вопросы §9).

Термины: C_ТС — стоимость единичной реализации техсбоя; ALE — годовая стоимость риска (ARO×SLE);
ROSI — дисконтированная выгода меры против полной стоимости владения за горизонт; вердикт —
устранить/компенсировать/принять с учётом вето (§3.2).
"""
from __future__ import annotations

from dataclasses import dataclass, field

# ── Значения по умолчанию (переопределяемы через EconConfig) ──
DISCOUNT_RATE_ANNUAL = 0.20   # r годовая — ЗАГЛУШКА до ответа заказчика (§9 параметр 3)
HORIZON_MONTHS = 24           # T горизонт ROSI (принято, §3.1)

# K_время — множитель ставки восстановления по времени суток (§2.1).
K_TIME_BUSINESS = 1.0   # рабочее время
K_TIME_EVENING = 1.5    # вечер/ночь
K_TIME_WEEKEND = 2.0    # выходные/праздники

# Порог «деградация → простой»: K≥0.7 держится ≥15 мин → учитывать как простой (§2.2).
DEGRADATION_DOWNTIME_K = 0.7
DEGRADATION_DOWNTIME_MINUTES = 15

# Ступенчатая шкала производительной деградации: (кратность отклика к нормативу → K) (§2.2).
PERF_DEGRADATION_SCALE = ((1, 0.0), (2, 0.2), (3, 0.35), (5, 0.5), (10, 0.8))
PERF_DEGRADATION_MAX_K = 1.0  # > ×10 или таймауты


# ─────────────────────────────────────────────────────────────────────────────
# C_ТС — стоимость единичной реализации техсбоя (§2.1, RE-07)
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class LineLabor:
    """Трудозатраты одной линии сопровождения на инцидент."""
    hours: float
    rate_per_hour: float
    k_time: float = K_TIME_BUSINESS


@dataclass
class DowntimeEntry:
    """Простой одного затронутого бизнес-процесса."""
    minutes: float
    cost_per_min: float
    k_impact: float = 1.0   # ∈[0,1]; для деградации <1
    share: float = 1.0      # доля процесса, обслуживаемая данной ИС


def cost_recovery(labors: list[LineLabor]) -> float:
    """C_восстановление = Σ по линиям (T_линия × R_линия × K_время) (§2.1)."""
    return float(sum(l.hours * l.rate_per_hour * l.k_time for l in labors))


def cost_downtime(entries: list[DowntimeEntry]) -> float:
    """C_простой = Σ по затронутым БП (T_недоступности × C_мин × K_влияния × доля) (§2.1)."""
    return float(sum(e.minutes * e.cost_per_min * e.k_impact * e.share for e in entries))


def cost_incident(
    labors: list[LineLabor] | None = None,
    downtime: list[DowntimeEntry] | None = None,
    secondary: float = 0.0,
) -> float:
    """C_ТС = C_восстановление + C_простой + C_вторичные (§2.1)."""
    return round(
        cost_recovery(labors or []) + cost_downtime(downtime or []) + float(secondary), 2,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Деградация → K влияния (§2.2, задача 17)
# ─────────────────────────────────────────────────────────────────────────────

def k_performance_degradation(response_ratio: float) -> float:
    """K для производительной деградации по ступенчатой шкале (кратность отклика к нормативу)."""
    if response_ratio <= 1:
        return 0.0
    k = PERF_DEGRADATION_MAX_K
    for threshold, value in PERF_DEGRADATION_SCALE:
        if response_ratio <= threshold:
            k = value
            break
    return k


def k_functional_degradation(unavailable_weight: float, total_weight: float) -> float:
    """K = Σ веса недоступных функций / Σ веса всех (функциональная деградация)."""
    if total_weight <= 0:
        return 0.0
    return round(min(1.0, max(0.0, unavailable_weight / total_weight)), 4)


def k_throughput_degradation(actual: float, required: float) -> float:
    """K = 1 − (факт. пропускная / требуемая) (пропускная деградация)."""
    if required <= 0:
        return 0.0
    return round(min(1.0, max(0.0, 1.0 - actual / required)), 4)


def degradation_counts_as_downtime(
    k_impact: float,
    minutes: float,
    k_threshold: float = DEGRADATION_DOWNTIME_K,
    min_minutes: float = DEGRADATION_DOWNTIME_MINUTES,
) -> bool:
    """Правило конвертации: сильная деградация достаточной длительности учитывается как простой."""
    return k_impact >= k_threshold and minutes >= min_minutes


# ─────────────────────────────────────────────────────────────────────────────
# ALE — годовая стоимость риска (§2.3, RE-09)
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class ALEResult:
    ale_avg: float          # средний — для приоритизации бюджета
    ale_p90: float | None   # «плохой год» — для планирования резерва
    max_sle: float | None   # максимальный единичный сценарий — для вето катастрофичности


def annual_loss_expectancy(aro: float, sle_avg: float,
                           sle_p90: float | None = None,
                           max_sle: float | None = None) -> ALEResult:
    """ALE = ARO × SLE. Три величины: средний / P90 / MaxSLE (§2.3) — иначе Mission Critical
    систематически недооценивается."""
    avg = round(float(aro) * float(sle_avg), 2)
    p90 = round(float(aro) * float(sle_p90), 2) if sle_p90 is not None else None
    return ALEResult(ale_avg=avg, ale_p90=p90, max_sle=(round(float(max_sle), 2)
                                                        if max_sle is not None else None))


def sle_from_incidents(incident_costs: list[float]) -> float:
    """SLE = средний C_ТС по историческим реализациям (§2.3)."""
    costs = [c for c in incident_costs if c is not None]
    return round(sum(costs) / len(costs), 2) if costs else 0.0


# ─────────────────────────────────────────────────────────────────────────────
# ROSI — дисконтированная оценка меры (§3.1, RE-12)
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class ROSIResult:
    rosi: float           # (Выгода − Затраты) / Затраты
    benefit_pv: float     # приведённая выгода (дисконтированный ΔALE за горизонт)
    cost_pv: float        # приведённые затраты (CAPEX + дисконтированный OPEX)


def _monthly_rate(annual_rate: float) -> float:
    return (1.0 + annual_rate) ** (1.0 / 12.0) - 1.0


def rosi(
    capex: float,
    opex_per_year: float,
    delta_ale_per_year: float,
    implementation_months: float = 0.0,
    horizon_months: int = HORIZON_MONTHS,
    annual_discount_rate: float = DISCOUNT_RATE_ANNUAL,
) -> ROSIResult:
    """ROSI = (Выгода − Затраты)/Затраты за горизонт T.

    Ключевая методологическая правка (§3.1): сравнивается ДИСКОНТИРОВАННЫЙ ALE за горизонт против
    полной стоимости владения мерой, НЕ единичный сбой против полной меры. Лаг внедрения
    `implementation_months` съедает часть выгоды (эффект идёт только после внедрения).
    """
    r_m = _monthly_rate(annual_discount_rate)
    delta_ale_month = float(delta_ale_per_year) / 12.0
    opex_month = float(opex_per_year) / 12.0

    benefit_pv = 0.0
    start = int(round(implementation_months)) + 1
    for t in range(start, horizon_months + 1):
        benefit_pv += delta_ale_month / ((1.0 + r_m) ** t)

    cost_pv = float(capex)
    for t in range(1, horizon_months + 1):
        cost_pv += opex_month / ((1.0 + r_m) ** t)

    value = (benefit_pv - cost_pv) / cost_pv if cost_pv > 0 else float("inf")
    return ROSIResult(rosi=round(value, 4), benefit_pv=round(benefit_pv, 2), cost_pv=round(cost_pv, 2))


# ─────────────────────────────────────────────────────────────────────────────
# Решение: вето-фильтры + ROSI → вердикт (§3.2, RE-13)
# ─────────────────────────────────────────────────────────────────────────────

VERDICT_ELIMINATE = "ELIMINATE"
VERDICT_COMPENSATE = "COMPENSATE"
VERDICT_ACCEPT = "ACCEPT"


@dataclass
class DecisionInput:
    rosi: float | None = None           # ROSI меры (None — меры ещё нет)
    ale: float = 0.0                    # годовая стоимость риска (для сравнения с аппетитом)
    risk_appetite: float | None = None  # порог принятия (по классу ИС / по риску)
    regulatory: bool = False            # регуляторное вето (ГОСТ/187-ФЗ/КИИ)
    max_sle: float | None = None        # макс. единичный сценарий (для вето катастрофичности)
    catastrophe_threshold: float | None = None  # порог катастрофичности (напр. 1% EBITDA)
    reasons: list[str] = field(default_factory=list)


@dataclass
class DecisionResult:
    verdict: str
    reasons: list[str]


def decide(inp: DecisionInput) -> DecisionResult:
    """Итоговое правило (§3.2): вето имеют приоритет над экономикой.

    ЕСЛИ сработало любое вето → Устранить;
    ИНАЧЕ ЕСЛИ ROSI>0 → Устранить;
    ИНАЧЕ ЕСЛИ ALE>риск-аппетит → Компенсировать;
    ИНАЧЕ → Принять (с подписью).
    """
    reasons: list[str] = []
    if inp.regulatory:
        reasons.append("регуляторное вето (мера обязательна независимо от ROSI)")
        return DecisionResult(VERDICT_ELIMINATE, reasons)
    if inp.max_sle is not None and inp.catastrophe_threshold is not None \
            and inp.max_sle >= inp.catastrophe_threshold:
        reasons.append("вето катастрофичности (MaxSLE выше порога)")
        return DecisionResult(VERDICT_ELIMINATE, reasons)

    if inp.rosi is not None and inp.rosi > 0:
        reasons.append(f"ROSI>0 ({inp.rosi:+.2f}) — устранение экономически обосновано")
        return DecisionResult(VERDICT_ELIMINATE, reasons)

    if inp.risk_appetite is not None and inp.ale > inp.risk_appetite:
        reasons.append("ROSI≤0, но риск выше аппетита — компенсировать дешевле, чем устранять причину")
        return DecisionResult(VERDICT_COMPENSATE, reasons)

    reasons.append("ROSI≤0 и риск в пределах аппетита — принять с подписью и датой пересмотра")
    return DecisionResult(VERDICT_ACCEPT, reasons)
