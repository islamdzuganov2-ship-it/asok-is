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

import calendar
from dataclasses import dataclass, field
from datetime import date, datetime

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


# ─────────────────────────────────────────────────────────────────────────────
# §17.2 (УК-43/44) — маршрутизация мер по критичности
# ─────────────────────────────────────────────────────────────────────────────

def measure_ale_risk(risk_ale_shares: list[tuple[float, float]]) -> float:
    """Деньги под риском, которые снимает мера: Σ(ale_avg × доля_снятия) по связанным рискам
    (§17.2). Пары (ale_avg, ale_reduction_share); share=None трактуется как 1.0 у вызывающей
    стороны (тот же приём, что _linked_risks в governance/economics_service.py)."""
    return round(sum(ale * share for ale, share in risk_ale_shares), 2)


def requires_escalation(
    ale_risk: float,
    risk_appetite: float | None,
    threshold_share: float,
    is_blocking: bool = False,
    regulatory: bool = False,
) -> bool:
    """Маршрутизация минор/крит (§17.2). is_blocking (Mission Critical под угрозой) и
    regulatory (вето) переопределяют денежный порог — эскалация всегда, без исключений
    (§17.2, УК-44). Порог — доля `threshold_share` от риск-аппетита класса ИС (В-56); без
    аппетита (не задан для класса) — консервативно эскалируем любую меру с деньгами под ней,
    чтобы отсутствие данных не маскировалось молчаливым авто-одобрением."""
    if is_blocking or regulatory:
        return True
    if risk_appetite is None or risk_appetite <= 0:
        return ale_risk > 0
    return ale_risk > (risk_appetite * threshold_share)


# ─────────────────────────────────────────────────────────────────────────────
# §17.4 (УК-49/50) — Ц_ОМ: цена неисполнения меры ответственным
# ─────────────────────────────────────────────────────────────────────────────

def price_of_inaction_eliminating(measure_ale_risk_value: float) -> float:
    """Ц_ОМ устраняющей меры (по умолчанию) — деньги под риском, остающиеся незакрытыми,
    пока мера просрочена и не выполнена (§17.4, УК-49). Тот же `ale_risk`, что и в
    маршрутизации (§17.2) — не два разных расчёта одной и той же связи риск↔мера."""
    return round(max(0.0, measure_ale_risk_value), 2)


def price_of_inaction_compensating(realized_incident_costs: list[float]) -> float:
    """Ц_ОМ компенсирующей меры — ДРУГАЯ формула (§17.4, УК-50): компенсирующая мера не
    снижает вероятность риска, а гасит последствия, поэтому цена бездействия — это фактически
    реализовавшийся ущерб (Σ C_ТС по инцидентам, связанным с риском, за период просрочки), а
    не доля ALE. Пустой список (пока не было инцидентов после просрочки) → 0.0, не ошибка."""
    return round(sum(c for c in realized_incident_costs if c), 2)


# ─────────────────────────────────────────────────────────────────────────────
# ТЗ v19 п.15 (УК-37) — эффект меры во времени: горизонт по кварталам, точка окупаемости
# ─────────────────────────────────────────────────────────────────────────────

def _add_months(d: date, months: int) -> date:
    total = d.month - 1 + months
    year = d.year + total // 12
    month = total % 12 + 1
    day = min(d.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


def _quarter_start_of(d: date) -> date:
    return date(d.year, ((d.month - 1) // 3) * 3 + 1, 1)


def _next_quarter_start(q_start: date) -> date:
    month = q_start.month + 3
    year = q_start.year
    if month > 12:
        month -= 12
        year += 1
    return date(year, month, 1)


def _quarter_label(d: date) -> str:
    return f"{d.year}-Q{(d.month - 1) // 3 + 1}"


@dataclass
class QuarterEffectPoint:
    quarter_label: str
    quarter_start: date
    net_cash: float    # чистый операционный эффект ЭТОГО квартала (0 до выхода на эффект)
    cumulative: float  # накопленный эффект С УЧЁТОМ CAPEX как разового минуса в квартале старта


@dataclass
class MeasureEffectTimeline:
    """Результат самодостаточен для карточки меры (пункт 15: «ни один эффект без периода»)."""
    computable: bool
    reason: str | None = None
    start_date: date | None = None
    effect_start_date: date | None = None
    capex: float = 0.0
    points: list[QuarterEffectPoint] = field(default_factory=list)
    payback_quarter: str | None = None


def measure_effect_timeline(
    start_date: date | datetime | None,
    implementation_months: float | None,
    capex: float | None,
    opex_per_year: float | None,
    delta_ale_cash: float | None,
    horizon_quarters: int = 8,
) -> MeasureEffectTimeline:
    """Горизонт эффекта меры по кварталам (В-48: гранулярность — квартал, рекомендация ТЗ).
    Эффект наступает СТУПЕНЬКОЙ с даты выхода на эффект (старт + лаг внедрения), без плавного
    ramp-up — заказчик не ответил на В-49, придумывать кривую без данных значит показывать
    цифру, на вопрос «почему такая» о которой нечем ответить (§6 ТЗ). Точка окупаемости
    учитывает лаг «бесплатно»: до effect_start_date квартальный чистый эффект = 0, cumulative
    не растёт, окупаемость физически не может наступить раньше выхода на эффект."""
    if start_date is None:
        return MeasureEffectTimeline(computable=False, reason="мера не одобрена — дата старта не определена")
    start = start_date.date() if isinstance(start_date, datetime) else start_date

    lag_months = round(implementation_months or 0.0)
    effect_start = _add_months(start, lag_months)
    effect_start_q = _quarter_start_of(effect_start)
    quarterly_net = (delta_ale_cash or 0.0) / 4.0 - (opex_per_year or 0.0) / 4.0

    cumulative = -(capex or 0.0)
    q_start = _quarter_start_of(start)
    points: list[QuarterEffectPoint] = []
    payback_quarter: str | None = None
    for _ in range(horizon_quarters):
        active = q_start >= effect_start_q
        net_this = round(quarterly_net, 2) if active else 0.0
        cumulative = round(cumulative + net_this, 2)
        label = _quarter_label(q_start)
        points.append(QuarterEffectPoint(quarter_label=label, quarter_start=q_start, net_cash=net_this, cumulative=cumulative))
        if payback_quarter is None and cumulative >= 0:
            payback_quarter = label
        q_start = _next_quarter_start(q_start)

    return MeasureEffectTimeline(
        computable=True, start_date=start, effect_start_date=effect_start, capex=capex or 0.0,
        points=points, payback_quarter=payback_quarter,
    )
