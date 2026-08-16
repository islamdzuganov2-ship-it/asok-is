"""
Логика домена econ (BL-007, RE-01…RE-04): CRUD экономических справочников + финпараметры контура.

Справочники — «фундамент денег»: их наполняет аналитик/риск-менеджер вручную (пилот идёт от ручного
ввода, не от автовыгрузки ITSM). Значения финпараметров хранятся в БД (EconConfig), а не в коде, —
чтобы менять ставку дисконта/пороги/аппетит без деплоя. Движок (economics.py) читает эти данные
через сервис и остаётся чистым.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.econ import economics
from app.modules.econ.models import (
    BENCHMARK_BP_COST,
    BENCHMARK_KINDS,
    BENCHMARK_SUPPORT_RATE,
    BP_KINDS,
    COST_METHODS,
    ENTERPRISE_PROFILE_ID,
    EXECUTOR_INTERNAL,
    EXECUTOR_TYPES,
    EXECUTOR_VENDOR,
    LINES,
    SIZE_CLASSES,
    BusinessProcess,
    BusinessProcessCost,
    EconConfig,
    EnterpriseProfile,
    MarketBenchmark,
    SupportRate,
    SystemBusinessProcess,
)
from app.modules.econ.schemas import (
    BenchmarkComparisonOut,
    BpCostIn,
    BusinessProcessCreate,
    BusinessProcessUpdate,
    EnterpriseProfileIn,
    MarketBenchmarkCreate,
    MarketBenchmarkOut,
    SupportRateIn,
    SupportRateUpdate,
    SystemBpCreate,
)
from app.shared.exceptions import ConflictError, NotFoundError, ValidationError

# ── Финпараметры контура по умолчанию (§3, §4.3). ЗАГЛУШКИ, где нужен ответ заказчика (§9). ──
# Значения редактируются через API PUT /econ/config/{key} — здесь только первичный сид.
DEFAULT_CONFIG: dict[str, dict] = {
    "discount_rate_annual": {
        "value": 0.20,
        "description": "Ставка дисконтирования r (годовая) для ROSI. ЗАГЛУШКА — уточнить у заказчика (§9.3).",
    },
    "rosi_horizon_months": {
        "value": 24,
        "description": "Горизонт ROSI T, мес (принято, §3.1).",
    },
    "itsm_history_months": {
        "value": 12,
        "description": "Глубина истории ТС, мес — окно наблюдения для расчёта ARO по фактике (§2.3).",
    },
    "k_time": {
        "value": {"business": 1.0, "evening": 1.5, "weekend": 2.0},
        "description": "K_время восстановления: рабочее/вечер-ночь/выходные (§2.1).",
    },
    "k_overhead": {
        "value": 1.6,
        "description": "K_накладных к ФОТ для внутренней ставки (1,4–1,8). ЗАГЛУШКА — уточнить (§9.1).",
    },
    "weights_alpha_min": {
        "value": 0.3,
        "description": "α_min — нижняя граница нормативного веса, защита защищённости от обнуления (§4.3).",
    },
    "weights_n0": {
        "value": 12,
        "description": "N₀ — порог статистической устойчивости для перехода весов (§4.3).",
    },
    "degradation_downtime": {
        "value": {"k": 0.7, "minutes": 15},
        "description": "Порог конвертации деградация→простой: K≥0.7 держится ≥15 мин (§2.2).",
    },
    "catastrophe_threshold": {
        "value": None,
        "description": "Порог вето катастрофичности MaxSLE (напр. 1% годовой EBITDA). ЗАДАТЬ (§3.2).",
    },
    "acceptance_matrix": {
        "value": [
            {"max_ale": 1_000_000, "signer": "Владелец ИС"},
            {"max_ale": 10_000_000, "signer": "CIO"},
            {"max_ale": None, "signer": "Правление/комитет"},
        ],
        "description": "Матрица акцепта: подписант принятия риска по сумме ALE (§3.3). Пороги — предложение.",
    },
    "nc_sla_days": {
        "value": 30,
        "description": "SLA на решение по несоответствию: >N дней в статусе «Оценено» → эскалация (§3.3).",
    },
    "nc_review_months": {
        "value": 6,
        "description": "Срок переоценки принятого риска по умолчанию, мес (§3.3).",
    },
    "risk_appetite_by_class": {
        "value": {"Mission Critical": 500_000, "Business Critical": 2_000_000, "Support": 5_000_000},
        "description": "Риск-аппетит по классу ИС, ₽/год. ЗАГЛУШКА — сверить с заказчиком (§3.2).",
    },
}


# ═══════════════════════ Финпараметры (EconConfig) ═══════════════════════

async def seed_econ_defaults(db: AsyncSession) -> int:
    """Идемпотентный сид финпараметров: добавляет только отсутствующие ключи (не затирает правки)."""
    existing = set((await db.execute(select(EconConfig.key))).scalars().all())
    added = 0
    for key, item in DEFAULT_CONFIG.items():
        if key in existing:
            continue
        db.add(EconConfig(key=key, value=item["value"], description=item["description"]))
        added += 1
    if added:
        await db.commit()
    return added


async def get_config(db: AsyncSession) -> list[EconConfig]:
    return list((await db.execute(select(EconConfig).order_by(EconConfig.key))).scalars().all())


async def set_config(db: AsyncSession, key: str, value: object, description: str | None) -> EconConfig:
    row = await db.get(EconConfig, key)
    if row is None:
        row = EconConfig(key=key, value=value, description=description)
        db.add(row)
    else:
        row.value = value
        if description is not None:
            row.description = description
    await db.commit()
    await db.refresh(row)
    return row


async def config_value(db: AsyncSession, key: str, default: object = None) -> object:
    """Достать одно значение параметра (для движка/сервисов). Возвращает default, если ключа нет."""
    row = await db.get(EconConfig, key)
    return row.value if row is not None else default


# ═══════════════════ Профиль предприятия (ТЗ v19 УК-21, п.8, Р-4) ═══════════════════
# РОВНО одна запись — id зафиксирован (ENTERPRISE_PROFILE_ID), не справочник организаций.

async def get_enterprise_profile(db: AsyncSession) -> EnterpriseProfile:
    """Всегда возвращает запись — создаёт пустую при первом обращении (get-or-create),
    чтобы фронту не приходилось различать «профиля ещё нет» и «профиль пуст»."""
    profile = await db.get(EnterpriseProfile, ENTERPRISE_PROFILE_ID)
    if profile is None:
        profile = EnterpriseProfile(id=ENTERPRISE_PROFILE_ID)
        db.add(profile)
        await db.commit()
        await db.refresh(profile)
    return profile


async def update_enterprise_profile(
    db: AsyncSession, payload: EnterpriseProfileIn, updated_by: uuid.UUID | None,
) -> EnterpriseProfile:
    if payload.size_class is not None and payload.size_class not in SIZE_CLASSES:
        raise ValidationError(f"Недопустимый класс размера: {payload.size_class}")

    profile = await get_enterprise_profile(db)
    for field_name, value in payload.model_dump(exclude_unset=True).items():
        setattr(profile, field_name, value)
    profile.updated_by = updated_by
    await db.commit()
    await db.refresh(profile)
    return profile


# ═══════════════════════ Бизнес-процессы (E9) ═══════════════════════

async def list_business_processes(db: AsyncSession) -> list[BusinessProcess]:
    stmt = select(BusinessProcess).order_by(BusinessProcess.code)
    return list((await db.execute(stmt)).scalars().all())


async def get_bp_or_404(db: AsyncSession, bp_id: uuid.UUID) -> BusinessProcess:
    bp = await db.get(BusinessProcess, bp_id)
    if bp is None:
        raise NotFoundError("Бизнес-процесс не найден")
    return bp


async def create_business_process(db: AsyncSession, data: BusinessProcessCreate) -> BusinessProcess:
    if data.kind not in BP_KINDS:
        raise ValidationError(f"Недопустимый тип БП: {data.kind}")
    dup = (await db.execute(select(BusinessProcess).where(BusinessProcess.code == data.code))).scalar_one_or_none()
    if dup is not None:
        raise ConflictError(f"Бизнес-процесс с кодом {data.code} уже существует")
    bp = BusinessProcess(**data.model_dump(exclude_none=True))
    db.add(bp)
    await db.commit()
    await db.refresh(bp)
    return bp


async def update_business_process(
    db: AsyncSession, bp: BusinessProcess, data: BusinessProcessUpdate,
) -> BusinessProcess:
    patch = data.model_dump(exclude_unset=True)
    if patch.get("kind") and patch["kind"] not in BP_KINDS:
        raise ValidationError(f"Недопустимый тип БП: {patch['kind']}")
    for field, value in patch.items():
        setattr(bp, field, value)
    await db.commit()
    await db.refresh(bp)
    return bp


# ── Связь ИС↔БП ──
async def link_system_bp(db: AsyncSession, system_id: uuid.UUID, data: SystemBpCreate) -> SystemBusinessProcess:
    await get_bp_or_404(db, data.business_process_id)
    dup = (await db.execute(
        select(SystemBusinessProcess).where(
            SystemBusinessProcess.system_id == system_id,
            SystemBusinessProcess.business_process_id == data.business_process_id,
        )
    )).scalar_one_or_none()
    if dup is not None:
        raise ConflictError("Эта ИС уже связана с данным бизнес-процессом")
    link = SystemBusinessProcess(system_id=system_id, **data.model_dump(exclude_none=True))
    db.add(link)
    await db.commit()
    await db.refresh(link)
    return link


async def list_system_bps(db: AsyncSession, system_id: uuid.UUID) -> list[SystemBusinessProcess]:
    stmt = select(SystemBusinessProcess).where(SystemBusinessProcess.system_id == system_id)
    return list((await db.execute(stmt)).scalars().all())


# ── Стоимость минуты простоя (C_мин) — одна карточка на БП (upsert) ──
async def upsert_bp_cost(db: AsyncSession, bp_id: uuid.UUID, data: BpCostIn) -> BusinessProcessCost:
    await get_bp_or_404(db, bp_id)
    if data.method not in COST_METHODS:
        raise ValidationError(f"Недопустимый метод расчёта C_мин: {data.method}")
    row = (await db.execute(
        select(BusinessProcessCost).where(BusinessProcessCost.business_process_id == bp_id)
    )).scalar_one_or_none()
    payload = data.model_dump(exclude_none=True)
    if row is None:
        row = BusinessProcessCost(business_process_id=bp_id, **payload)
        db.add(row)
    else:
        for field, value in payload.items():
            setattr(row, field, value)
    await db.commit()
    await db.refresh(row)
    return row


async def get_bp_cost(db: AsyncSession, bp_id: uuid.UUID) -> BusinessProcessCost | None:
    return (await db.execute(
        select(BusinessProcessCost).where(BusinessProcessCost.business_process_id == bp_id)
    )).scalar_one_or_none()


# ═══════════════════════ Ставки сопровождения (E8) ═══════════════════════

def _validate_rate(line: str | None, executor_type: str | None) -> None:
    if line is not None and line not in LINES:
        raise ValidationError(f"Недопустимая линия сопровождения: {line}")
    if executor_type is not None and executor_type not in EXECUTOR_TYPES:
        raise ValidationError(f"Недопустимый тип исполнителя: {executor_type}")


async def list_rates(db: AsyncSession, *, system_id: uuid.UUID | None = None) -> list[SupportRate]:
    stmt = select(SupportRate)
    if system_id is not None:
        stmt = stmt.where(SupportRate.system_id == system_id)
    return list((await db.execute(stmt.order_by(SupportRate.line))).scalars().all())


async def get_rate_or_404(db: AsyncSession, rate_id: uuid.UUID) -> SupportRate:
    rate = await db.get(SupportRate, rate_id)
    if rate is None:
        raise NotFoundError("Ставка сопровождения не найдена")
    return rate


async def create_rate(db: AsyncSession, data: SupportRateIn) -> SupportRate:
    _validate_rate(data.line, data.executor_type)
    rate = SupportRate(**data.model_dump(exclude_none=True))
    db.add(rate)
    await db.commit()
    await db.refresh(rate)
    return rate


async def update_rate(db: AsyncSession, rate: SupportRate, data: SupportRateUpdate) -> SupportRate:
    patch = data.model_dump(exclude_unset=True)
    _validate_rate(patch.get("line"), patch.get("executor_type"))
    for field, value in patch.items():
        setattr(rate, field, value)
    await db.commit()
    await db.refresh(rate)
    return rate


async def resolve_support_rate(
    db: AsyncSession, *, line: str, system_id: uuid.UUID | None = None,
) -> SupportRate | None:
    """Применимая ставка для линии: сначала специфичная для ИС, иначе глобальная (system_id IS NULL).

    Смешанная модель (§2.4): ставка — атрибут связки ИС×линия×исполнитель, единой «ставки L2» нет.
    Движок C_восстановление берёт ставку отсюда.
    """
    if system_id is not None:
        specific = (await db.execute(
            select(SupportRate).where(
                SupportRate.system_id == system_id,
                SupportRate.line == line,
                SupportRate.is_active.is_(True),
            )
        )).scalars().first()
        if specific is not None:
            return specific
    return (await db.execute(
        select(SupportRate).where(
            SupportRate.system_id.is_(None),
            SupportRate.line == line,
            SupportRate.is_active.is_(True),
        )
    )).scalars().first()


# ═══════════════════════ C_ТС: оркестровка стоимости реализации ТС (RE-07) ═══════════════════════

_DEFAULT_K_TIME = {"business": 1.0, "evening": 1.5, "weekend": 2.0}


def _k_time_for(occurred_at: datetime | None, cfg: dict) -> float:
    """K_время по моменту сбоя (§2.1): выходные / вечер-ночь / рабочее время."""
    if occurred_at is None:
        return float(cfg.get("business", 1.0))
    if occurred_at.weekday() >= 5:               # суббота/воскресенье
        return float(cfg.get("weekend", 2.0))
    if occurred_at.hour < 8 or occurred_at.hour >= 20:  # вечер/ночь
        return float(cfg.get("evening", 1.5))
    return float(cfg.get("business", 1.0))


async def compute_incident_cost(db: AsyncSession, incident) -> float:
    """C_ТС = C_восстановление + C_простой (+ вторичные) для одного техсбоя (§2.1, RE-07).

    Берёт входы из справочников econ: ставки L1/L2/L3 (по связке ИС×линия) и стоимость минуты БП
    (через связь ИС↔БП). `incident` — duck-typed (поля TechIncident), домен не импортируется, чтобы
    econ оставался нижним слоем. Результат кэшируется в `incident.cost_total`; коммит — за вызывающим.
    """
    k_time_cfg = await config_value(db, "k_time", _DEFAULT_K_TIME) or _DEFAULT_K_TIME
    k_time = _k_time_for(getattr(incident, "occurred_at", None), k_time_cfg)
    system_id = getattr(incident, "system_id", None)

    # C_восстановление — по линиям с известной ставкой (иначе линия не костится).
    labors: list = []
    for line, attr in (("L1", "labor_l1_hours"), ("L2", "labor_l2_hours"), ("L3", "labor_l3_hours")):
        hours = getattr(incident, attr, None)
        if not hours:
            continue
        rate = await resolve_support_rate(db, line=line, system_id=system_id)
        if rate is None:
            continue
        labors.append(economics.LineLabor(
            hours=float(hours), rate_per_hour=float(rate.rate_per_hour), k_time=k_time,
        ))

    # C_простой — по затронутым БП (через связь ИС↔БП и карточку стоимости минуты).
    minutes = getattr(incident, "downtime_minutes", None)
    if minutes is None:
        occ, res = getattr(incident, "occurred_at", None), getattr(incident, "resolved_at", None)
        if occ is not None and res is not None:
            minutes = (res - occ).total_seconds() / 60.0
    downtime: list = []
    if minutes and system_id is not None:
        for link in await list_system_bps(db, system_id):
            cost = await get_bp_cost(db, link.business_process_id)
            if cost is None or cost.cost_per_min_base is None:
                continue
            k = getattr(incident, "k_impact", None)
            if k is None:
                k = link.default_k_impact if link.default_k_impact is not None else 1.0
            downtime.append(economics.DowntimeEntry(
                minutes=float(minutes), cost_per_min=float(cost.cost_per_min_base),
                k_impact=float(k), share=float(link.share),
            ))

    total = economics.cost_incident(labors=labors, downtime=downtime, secondary=0.0)
    incident.cost_total = total
    return total


# ═══════════════════════ Рыночные бенчмарки (ТЗ v19 п.9-10, В-30а) ═══════════════════════
# Структура без числового наполнения: заказчик не выбрал источники (В-30а), таблица пуста до
# первой ручной записи. compare_* НЕ подменяют отсутствие данных средним «на глаз» — честное
# note объясняет, чего не хватает (самой записи БП/ставки или бенчмарка для её измерения).

def _validate_benchmark(data: MarketBenchmarkCreate) -> None:
    if data.kind not in BENCHMARK_KINDS:
        raise ValidationError(f"Недопустимый тип бенчмарка: {data.kind}")
    if data.kind == BENCHMARK_BP_COST and data.dimension not in BP_KINDS:
        raise ValidationError(f"Недопустимый тип БП для бенчмарка C_мин: {data.dimension}")
    if data.kind == BENCHMARK_SUPPORT_RATE and data.dimension not in EXECUTOR_TYPES:
        raise ValidationError(f"Недопустимый тип исполнителя для бенчмарка ставки: {data.dimension}")
    if data.company_size_class is not None and data.company_size_class not in SIZE_CLASSES:
        raise ValidationError(f"Недопустимый класс размера: {data.company_size_class}")


async def create_benchmark(
    db: AsyncSession, data: MarketBenchmarkCreate, created_by: uuid.UUID | None,
) -> MarketBenchmark:
    _validate_benchmark(data)
    row = MarketBenchmark(**data.model_dump(), created_by=created_by)
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


async def list_benchmarks(db: AsyncSession, kind: str | None = None) -> list[MarketBenchmark]:
    stmt = select(MarketBenchmark).order_by(MarketBenchmark.observed_on.desc())
    if kind:
        stmt = stmt.where(MarketBenchmark.kind == kind)
    return list((await db.execute(stmt)).scalars().all())


async def _latest_benchmark(
    db: AsyncSession, kind: str, dimension: str, company_size_class: str | None = None,
) -> MarketBenchmark | None:
    """Самая свежая запись (по observed_on) для точки сравнения — рынок меняется, старую
    цифру молча использовать нельзя (см. observed_on в ответе — вызывающий код её показывает)."""
    stmt = (
        select(MarketBenchmark)
        .where(MarketBenchmark.kind == kind, MarketBenchmark.dimension == dimension)
        .order_by(MarketBenchmark.observed_on.desc())
    )
    if company_size_class is not None:
        stmt = stmt.where(MarketBenchmark.company_size_class == company_size_class)
    return (await db.execute(stmt)).scalars().first()


async def compare_business_process(db: AsyncSession, bp_id: uuid.UUID) -> BenchmarkComparisonOut:
    """Сравнение C_мин своей БП с рыночным ориентиром того же типа БП (п.9)."""
    bp = await db.get(BusinessProcess, bp_id)
    if bp is None:
        raise NotFoundError("Бизнес-процесс не найден")
    cost = await get_bp_cost(db, bp_id)
    own = float(cost.cost_per_min_base) if cost and cost.cost_per_min_base is not None else None
    bench = await _latest_benchmark(db, BENCHMARK_BP_COST, bp.kind)
    return _comparison(own, "₽/мин", bench, no_own="стоимость минуты простоя не рассчитана")


async def compare_support_rate(db: AsyncSession, rate_id: uuid.UUID) -> BenchmarkComparisonOut:
    """Сравнение своей ставки сопровождения с рыночным ориентиром — тип исполнителя × размер
    компании (п.10, EnterpriseProfile — параметр подстановки).

    Рынок труда специалистов на практике не сегментирован по размеру банка ни в одном найденном
    источнике (В-30а, см. сид `seed_market_benchmarks`): если под конкретный size_class ориентира
    нет, сравнение откатывается на запись без company_size_class и явно помечает это в ответе —
    честнее, чем молчать «нет данных», когда общий ориентир на самом деле есть.
    """
    rate = await db.get(SupportRate, rate_id)
    if rate is None:
        raise NotFoundError("Ставка сопровождения не найдена")
    profile = await get_enterprise_profile(db)
    bench = await _latest_benchmark(db, BENCHMARK_SUPPORT_RATE, rate.executor_type, profile.size_class)
    size_note = ""
    if bench is None and profile.size_class is not None:
        bench = await _latest_benchmark(db, BENCHMARK_SUPPORT_RATE, rate.executor_type, None)
        if bench is not None:
            size_note = " Рынок не сегментирован по размеру банка — показан общий ориентир."
    return _comparison(float(rate.rate_per_hour), "₽/час", bench, no_own="", note_suffix=size_note)


def _comparison(
    own: float | None, own_unit: str, bench: MarketBenchmark | None, no_own: str,
    note_suffix: str = "",
) -> BenchmarkComparisonOut:
    if own is None:
        return BenchmarkComparisonOut(own_value=None, own_unit=own_unit, note=no_own)
    if bench is None:
        return BenchmarkComparisonOut(
            own_value=own, own_unit=own_unit,
            note="Рыночный ориентир для этой комбинации не внесён",
        )
    if not bench.value:
        note = "ориентир внесён с нулевым значением — сравнение невозможно"
        delta_pct = None
    else:
        delta_pct = round((own - float(bench.value)) / float(bench.value) * 100, 1)
        direction = "выше" if delta_pct > 0 else "ниже"
        note = f"{direction} рыночного ориентира на {abs(delta_pct)}%"
    return BenchmarkComparisonOut(
        own_value=own, own_unit=own_unit, benchmark=MarketBenchmarkOut.model_validate(bench),
        delta_pct=delta_pct, note=note + note_suffix,
    )


# ── Сид source-данных (В-30а закрыт 16.08.2026, см. docs/ТЗ_19_Управленческий_Контур_и_Веса.md
# §0 доп. к Р-7). Каждая строка — цифра с реальным источником, не «на глаз»:
# - где источник не делит по типу БП (BP_KINDS) — внесена ОДНА агрегированная оценка на все три,
#   note каждой строки явно говорит, что это не три независимых измерения;
# - где рынок специалистов не делит ставку по размеру банка-работодателя — company_size_class
#   оставлен пустым осознанно (см. compare_support_rate — откат на такую запись с пометкой).
DEFAULT_BENCHMARKS: list[dict] = [
    {
        "kind": BENCHMARK_BP_COST,
        "dimension": dim,
        "company_size_class": None,
        "value": 12_500.00,
        "unit": "₽/мин",
        "source": (
            "Киберпротект (со ссылкой на РБК Компании, Anti-Malware.ru, Strategy Partners, "
            "TAdviser) — стоимость часа простоя ИТ для банков/страхования РФ, диапазон "
            "500 000–1 000 000 ₽/час, контекст МСБ"
        ),
        "observed_on": date(2026, 8, 16),
        "note": (
            "Внесена середина диапазона источника (750 000 ₽/час = 12 500 ₽/мин). Источник НЕ "
            "делит по типу бизнес-процесса — эта оценка применена одинаково ко всем трём "
            "BP_KINDS, это не три независимых измерения. Дата — дата обращения к источнику "
            "(точная дата публикации у источника не зафиксирована)."
        ),
    }
    for dim in BP_KINDS
] + [
    {
        "kind": BENCHMARK_SUPPORT_RATE,
        "dimension": EXECUTOR_INTERNAL,
        "company_size_class": None,
        "value": 516.26,
        "unit": "₽/час",
        "source": (
            "hh.ru — статистика зарплат по вакансии «Системный администратор», Москва (медиана)"
        ),
        "observed_on": date(2026, 8, 16),
        "note": (
            "82 601 ₽/мес ÷ 160 ч = 516,26 ₽/час — валовая ставка ФОТ, БЕЗ K_накладных. С учётом "
            "econ_config.k_overhead=1,6 ориентировочно ≈826 ₽/час эквивалент полной внутренней "
            "ставки — расчётная величина для сравнения, не наблюдение источника. Вторичный "
            "источник (разбивка по грейдам, валовые ₽/час без накладных): L1 281–563, "
            "L2 500–875, L3 813–1250 — для справки, отдельно не заведено (dimension бенчмарка "
            "ставки — INTERNAL/VENDOR, не линия L1/L2/L3). Не сегментировано по размеру банка-"
            "работодателя ни в одном найденном источнике — company_size_class пуст осознанно."
        ),
    },
    {
        "kind": BENCHMARK_SUPPORT_RATE,
        "dimension": EXECUTOR_VENDOR,
        "company_size_class": None,
        "value": 3_100.00,
        "unit": "₽/час",
        "source": "augment-tech.ru — ставки аренды DevOps-инженера (аутстаффинг), 09.06.2026",
        "observed_on": date(2026, 6, 9),
        "note": (
            "Ближайший открытый аналог вендорской ставки сопровождения — прямых ставок "
            "L1/L2/L3-аутстаффинга не найдено. Усреднено по 2 грейдам: Middle 2 800–3 000 "
            "₽/час (середина 2 900), Senior 3 200–3 400 ₽/час (середина 3 300) → среднее "
            "3 100 ₽/час. Не сегментировано по размеру банка-заказчика."
        ),
    },
]


async def seed_market_benchmarks(db: AsyncSession) -> int:
    """Идемпотентный сид рыночных бенчмарков: добавляет только отсутствующие (kind, dimension) —
    не трогает то, что уже введено вручную или предыдущим сидом (в т.ч. с другим source/value)."""
    rows = (await db.execute(select(MarketBenchmark.kind, MarketBenchmark.dimension))).all()
    existing = {(k, d) for k, d in rows}
    added = 0
    for item in DEFAULT_BENCHMARKS:
        if (item["kind"], item["dimension"]) in existing:
            continue
        db.add(MarketBenchmark(**item))
        added += 1
    if added:
        await db.commit()
    return added
