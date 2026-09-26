"""
Логика домена econ (BL-007, RE-01, RE-02, RE-03, RE-04): CRUD экономических справочников + финпараметры контура.

Справочники — «фундамент денег»: их наполняет аналитик/риск-менеджер вручную (пилот идёт от ручного
ввода, не от автовыгрузки ITSM). Значения финпараметров хранятся в БД (EconConfig), а не в коде, —
чтобы менять ставку дисконта/пороги/аппетит без деплоя. Движок (economics.py) читает эти данные
через сервис и остаётся чистым.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

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
    RATE_SOURCE_MANUAL,
    RATE_SOURCE_REFERENCE,
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
    BpCostOut,
    BusinessProcessCreate,
    BusinessProcessUpdate,
    EnterpriseProfileIn,
    FillDefaultRatesIn,
    FillDefaultRatesOut,
    MarketBenchmarkCreate,
    MarketBenchmarkOut,
    RateDeviationOut,
    RateDeviationsOut,
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
    # RE-20 (§7.2, В-14 ТЗ контура): метрики руководителей — диагностика или мотивация.
    # 'diagnostic' (по умолчанию, первые 2 квартала): ΔALE под управлением — по выполненным мерам.
    # 'motivation': засчитывается только ΔALE, подтверждённый независимой верификацией аудитора
    # (несоответствие в статусе «Верифицировано»), — жёсткий антигейминг при привязке к премии.
    "manager_metrics_mode": {
        "value": "diagnostic",
        "description": "Режим метрик руководителей: diagnostic (наблюдение) | motivation (ΔALE — "
                        "только подтверждённый аудитором, §7.2)",
    },
    # RE-19: норматив человеко-часов аналитика на одну оценку ИС — по глубине оценки.
    "assessment_norm_hours": {
        "value": {"FULL": 40, "PROFILE": 16, "SCREENING": 6},
        "description": "Норматив ч/ч аналитика на оценку ИС по глубине (RE-19): полная / профильная / "
                        "скрининг. Факт вводится при завершении оценки",
    },
    # ТЗ v19 п.10 (УК-26): порог отчёта «ставки, отличающиеся от типовых».
    "rate_deviation_threshold_pct": {
        "value": 20,
        "description": "Порог отчёта отклонений ставок от типовых, % (УК-26)",
    },
    # ТЗ v19 п.13 (УК-33, УК-22): норма загрузки исполнителя — часы открытых мер по размеру
    # предприятия (В-42: норма «на человека», от размера). Выше — перегружен, ниже половины — свободен.
    "executor_load_norm_hours": {
        "value": {"MICRO": 120, "SMALL": 140, "MEDIUM": 160, "LARGE": 160, "default": 160},
        "description": "Норма часов открытых мер на исполнителя по размеру предприятия (УК-33). Предложение",
    },
    # ТЗ v19 п.6 (УК-15): за сколько дней до срока меры уведомлять ответственного.
    "notify_due_soon_days": {
        "value": 3,
        "description": "За сколько дней до срока меры уходит уведомление «срок истекает» (УК-15)",
    },
    # ТЗ v19 п.1 (УК-03): целевое значение интегрального балла (В-6 б) — отметка на шкале.
    "quality_score_target": {
        "value": 0.81,
        "description": "Цель по интегральному баллу качества, доля 0..1 (УК-03). По умолчанию — "
                        "нижняя граница «высокого уровня»",
    },
    "nc_review_months": {
        "value": 6,
        "description": "Срок переоценки принятого риска по умолчанию, мес (§3.3).",
    },
    "risk_appetite_by_class": {
        "value": {"Mission Critical": 500_000, "Business Critical": 2_000_000, "Support": 5_000_000},
        "description": "Риск-аппетит по классу ИС, ₽/год. ЗАГЛУШКА — сверить с заказчиком (§3.2).",
    },
    # ТЗ v19 §17.2 (УК-43, В-56): порог маршрутизации мер — доля от риск-аппетита класса ИС.
    # Ниже порога — QUALITY_MANAGER/владелец решают сами (без governance.decide); выше — обязательная
    # эскалация к топ-менеджменту. По рекомендации §17.2, не фиксированная сумма в ₽.
    "measure_escalation_threshold_share": {
        "value": 0.10,
        "description": "Порог маршрутизации мер по критичности (§17.2): доля от риск-аппетита класса "
                        "ИС, выше которой мера обязательно эскалируется к топ-менеджменту (В-56).",
    },
    # ТЗ v19 §17.9 (УК-59, В-64): SLA автоэскалации несоответствия дифференцирован по level —
    # тот же критерий, что маршрутизация мер (не плодим два разных критерия критичности).
    "nc_sla_days_critical": {
        "value": 3,
        "description": "SLA на решение для CRITICAL несоответствий, дней (§17.9). "
                        "nc_sla_days выше — тот же срок для MINOR/MAJOR.",
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
    """RE-02: карточка C_мин. Если базовая стоимость не введена вручную, она считается движком по
    методу и параметрам (economics.cost_per_minute) — аналитик не открывает Excel. Транзакционный
    метод — только для выручкообразующих (FRONTAL) процессов: у бэк-офиса нет выручки на минуту,
    и цифра по такому методу была бы выдуманной."""
    bp = await get_bp_or_404(db, bp_id)
    if data.method not in COST_METHODS:
        raise ValidationError(f"Недопустимый метод расчёта C_мин: {data.method}")
    if data.method == economics.COST_METHOD_TRANSACTIONAL and bp.kind != "FRONTAL":
        raise ValidationError(
            "Транзакционный метод C_мин применим только к выручкообразующим (фронтальным) процессам"
        )
    if data.cost_per_min_base is None:
        computed = economics.cost_per_minute(data.method, data.params)
        if computed is not None:
            data = data.model_copy(update={"cost_per_min_base": computed.base})
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


def bp_cost_out(row: BusinessProcessCost | None) -> BpCostOut | None:
    """DTO карточки C_мин с диапазоном экспертной оценки (RE-02) — неопределённость видна рядом."""
    if row is None:
        return None
    out = BpCostOut.model_validate(row)
    computed = economics.cost_per_minute(row.method, row.params)
    if computed is not None:
        out.cost_per_min_low, out.cost_per_min_high = computed.low, computed.high
    return out


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
    payload = data.model_dump(exclude_none=True)
    fot = payload.pop("fot_monthly", None)
    fund = payload.pop("fund_hours_monthly", None)
    if payload.get("rate_per_hour") is None:
        # RE-03: внутренняя ставка из ФОТ — полная стоимость часа, а не «голая» зарплата (В-34).
        k_overhead = float(await config_value(db, "k_overhead", 1.6) or 1.6)
        computed = economics.internal_hourly_rate(fot or 0, k_overhead, fund or 0)
        if computed is None:
            raise ValidationError("Задайте ставку ₽/час или ФОТ в месяц и фонд рабочего времени")
        payload["rate_per_hour"] = computed
    rate = SupportRate(**payload)
    db.add(rate)
    await db.commit()
    await db.refresh(rate)
    return rate


async def update_rate(db: AsyncSession, rate: SupportRate, data: SupportRateUpdate,
                      username: str | None = None) -> SupportRate:
    patch = data.model_dump(exclude_unset=True)
    _validate_rate(patch.get("line"), patch.get("executor_type"))
    for field, value in patch.items():
        setattr(rate, field, value)
    # УК-25: правка значения руками — это и есть подтверждение: ставка перестаёт быть
    # «по справочнику» и больше не обновляется подстановкой дефолтов.
    if "rate_per_hour" in patch and rate.source == RATE_SOURCE_REFERENCE:
        rate.source = RATE_SOURCE_MANUAL
        rate.confirmed_at = datetime.now(timezone.utc)
        rate.confirmed_by = username
    await db.commit()
    await db.refresh(rate)
    return rate


async def resolve_support_rate(
    db: AsyncSession, *, line: str, system_id: uuid.UUID | None = None,
    executor_type: str | None = None,
) -> SupportRate | None:
    """Применимая ставка для линии (RE-03): связка ИС × линия × исполнитель.

    Порядок: (ИС, исполнитель) → (глобальная, исполнитель) → (ИС, любой) → (глобальная, любой).
    Смешанная модель (§2.4): часть линий закрывает вендор, часть — внутренняя команда, и у них
    разные ставки, K по времени, пакеты. Если под нужного исполнителя ставки нет, берётся любая
    ставка линии — лучше ориентир, чем некостированная линия (это видно в cost_breakdown).
    """
    async def _find(sys_id: uuid.UUID | None, executor: str | None) -> SupportRate | None:
        conds = [SupportRate.line == line, SupportRate.is_active.is_(True)]
        conds.append(SupportRate.system_id == sys_id if sys_id is not None else SupportRate.system_id.is_(None))
        if executor is not None:
            conds.append(SupportRate.executor_type == executor)
        return (await db.execute(select(SupportRate).where(*conds))).scalars().first()

    candidates = []
    if executor_type is not None:
        if system_id is not None:
            candidates.append((system_id, executor_type))
        candidates.append((None, executor_type))
    if system_id is not None:
        candidates.append((system_id, None))
    candidates.append((None, None))
    for sys_id, executor in candidates:
        found = await _find(sys_id, executor)
        if found is not None:
            return found
    return None


async def bp_cost_per_min_at(cost: BusinessProcessCost, moment: datetime | None) -> float | None:
    """C_мин в момент сбоя (RE-02): базовая стоимость × множитель временного профиля."""
    if cost.cost_per_min_base is None:
        return None
    return float(cost.cost_per_min_base) * economics.time_profile_factor(cost.time_profile, moment)


# ═══════════════════════ C_ТС: оркестровка стоимости реализации ТС (RE-07) ═══════════════════════

# K_время берётся из самой ставки (k_evening/k_weekend, RE-03): у вендора коэффициенты свои.


async def compute_incident_cost(
    db: AsyncSession, incident, vendor_hours_used: dict[str, float] | None = None,
) -> float:
    """C_ТС = C_восстановление + C_простой (+ вторичные) для одного техсбоя (§2.1, RE-07).

    Берёт входы из справочников econ: ставки L1/L2/L3 по связке ИС × линия × исполнитель (RE-03:
    вендорские линии — `labor_vendor_lines`, квант биллинга, K по времени самой ставки, пакет и
    сверхлимит) и стоимость минуты БП в момент сбоя (RE-02: метод + временной профиль).
    `incident` — duck-typed (поля TechIncident), домен не импортируется, чтобы econ оставался
    нижним слоем. `vendor_hours_used` — уже израсходованные в месяце часы пакета по линиям
    (считает вызывающий домен incidents). Результат кэшируется в `incident.cost_total` и
    разложение — в `incident.cost_breakdown`; коммит — за вызывающим.
    """
    occurred_at = getattr(incident, "occurred_at", None)
    system_id = getattr(incident, "system_id", None)
    vendor_lines = set(getattr(incident, "labor_vendor_lines", None) or [])
    used = vendor_hours_used or {}

    # C_восстановление — по линиям с известной ставкой (иначе линия не костится и это видно).
    recovery = 0.0
    lines_out: list[dict] = []
    for line, attr in (("L1", "labor_l1_hours"), ("L2", "labor_l2_hours"), ("L3", "labor_l3_hours")):
        hours = getattr(incident, attr, None)
        if not hours:
            continue
        executor = EXECUTOR_VENDOR if line in vendor_lines else EXECUTOR_INTERNAL
        rate = await resolve_support_rate(db, line=line, system_id=system_id, executor_type=executor)
        if rate is None:
            lines_out.append({"line": line, "hours": float(hours), "executor": executor, "cost": None,
                              "note": "нет ставки для линии — не учтено"})
            continue
        # Квант биллинга — условие вендорского контракта: внутренняя команда работает по факту
        # времени, округлять её часы вверх значило бы завышать собственный C_восст.
        billable = (economics.billable_hours(float(hours), float(rate.billing_quantum_min or 0))
                    if rate.executor_type == EXECUTOR_VENDOR else float(hours))
        k_time = economics.k_time_for_rate(occurred_at, float(rate.k_evening), float(rate.k_weekend))
        package_left = None
        if rate.executor_type == EXECUTOR_VENDOR and rate.package_hours is not None:
            package_left = max(0.0, float(rate.package_hours) - float(used.get(line, 0.0)))
        cost = economics.vendor_labor_cost(
            billable, float(rate.rate_per_hour), k_time, package_left,
            float(rate.overlimit_rate) if rate.overlimit_rate is not None else None,
        )
        recovery += cost
        lines_out.append({"line": line, "hours": float(hours), "billable_hours": billable,
                          "executor": rate.executor_type, "rate_per_hour": float(rate.rate_per_hour),
                          "k_time": k_time, "package_left": package_left, "cost": cost})

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
            if cost is None:
                continue
            per_min = await bp_cost_per_min_at(cost, occurred_at)
            if per_min is None:
                continue
            k = getattr(incident, "k_impact", None)
            if k is None:
                k = link.default_k_impact if link.default_k_impact is not None else 1.0
            downtime.append(economics.DowntimeEntry(
                minutes=float(minutes), cost_per_min=per_min,
                k_impact=float(k), share=float(link.share),
            ))

    downtime_cost = economics.cost_downtime(downtime)
    total = round(recovery + downtime_cost, 2)
    incident.cost_total = total
    if hasattr(incident, "cost_breakdown"):
        incident.cost_breakdown = {
            "recovery": round(recovery, 2), "downtime": round(downtime_cost, 2), "secondary": 0.0,
            "total": total, "lines": lines_out, "business_processes": len(downtime),
        }
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
    if data.line is not None and (data.kind != BENCHMARK_SUPPORT_RATE or data.line not in LINES):
        raise ValidationError("Линия задаётся только для типовой ставки сопровождения: L1/L2/L3")


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


# ═══════════════════ Типовые ставки и контроль отклонений (ТЗ v19 п.10, УК-25, УК-26) ═══════════════════

async def typical_rate(
    db: AsyncSession, *, line: str, executor_type: str,
) -> MarketBenchmark | None:
    """Типовая ставка из справочника (УК-25): размер предприятия × отрасль × линия × исполнитель.

    Размер и отрасль — из профиля предприятия (УК-21, УК-22). Запись с пустым разрезом — ориентир
    «для любых»; из подходящих берётся самая конкретная (линия важнее размера, размер — отрасли),
    при равенстве — самая свежая. Так рынок, не сегментированный по размеру банка (В-30а), всё
    равно даёт дефолт, но размерно-специфичная запись, если появится, его вытеснит."""
    profile = await get_enterprise_profile(db)
    rows = list((await db.execute(
        select(MarketBenchmark).where(
            MarketBenchmark.kind == BENCHMARK_SUPPORT_RATE,
            MarketBenchmark.dimension == executor_type,
        )
    )).scalars().all())

    def score(b: MarketBenchmark) -> tuple[int, date] | None:
        s = 0
        for value, own, weight in ((b.line, line, 4), (b.company_size_class, profile.size_class, 2),
                                   (b.industry, profile.industry, 1)):
            if value is None:
                continue
            if value != own:
                return None
            s += weight
        return s, b.observed_on

    scored = [(sc, b) for b in rows if (sc := score(b)) is not None]
    return max(scored, key=lambda x: x[0])[1] if scored else None


async def fill_default_rates(db: AsyncSession, data: FillDefaultRatesIn) -> FillDefaultRatesOut:
    """Подстановка типовых ставок вместо ввода с нуля (УК-25). Для каждой линии L1–L3 без ставки
    этой связки создаётся ставка «по справочнику, не подтверждена». refresh=True обновляет
    значения ранее подставленных НЕподтверждённых ставок (например, после смены размера
    предприятия); подтверждённые и ручные ставки не трогаются никогда."""
    _validate_rate(None, data.executor_type)
    scope = (SupportRate.system_id == data.system_id if data.system_id is not None
             else SupportRate.system_id.is_(None))
    existing = {
        r.line: r for r in (await db.execute(
            select(SupportRate).where(SupportRate.executor_type == data.executor_type, scope)
        )).scalars().all()
    }
    created = updated = 0
    missing: list[str] = []
    for line in LINES:
        ref = await typical_rate(db, line=line, executor_type=data.executor_type)
        if ref is None:
            missing.append(line)
            continue
        rate = existing.get(line)
        if rate is None:
            db.add(SupportRate(
                system_id=data.system_id, line=line, executor_type=data.executor_type,
                rate_per_hour=float(ref.value), source=RATE_SOURCE_REFERENCE,
                reference_benchmark_id=ref.id,
            ))
            created += 1
        elif (data.refresh and rate.source == RATE_SOURCE_REFERENCE and rate.confirmed_at is None
              and float(rate.rate_per_hour) != float(ref.value)):
            rate.rate_per_hour = float(ref.value)
            rate.reference_benchmark_id = ref.id
            updated += 1
    await db.commit()
    return FillDefaultRatesOut(created=created, updated=updated, skipped_no_reference=missing)


async def confirm_rate(db: AsyncSession, rate: SupportRate, username: str | None) -> SupportRate:
    """Подтвердить подставленную из справочника ставку (УК-25): значение остаётся, пометка
    «не подтверждена» снимается, и подстановка дефолтов её больше не перезапишет."""
    rate.confirmed_at = datetime.now(timezone.utc)
    rate.confirmed_by = username
    await db.commit()
    await db.refresh(rate)
    return rate


async def rate_deviations(db: AsyncSession, threshold_pct: float | None = None) -> RateDeviationsOut:
    """Отчёт «ставки, отличающиеся от типовых более чем на N%» (УК-26) — и проверка данных, и
    повод к переговорам с вендором. Ставка без типовой в справочнике попадает в отчёт отдельной
    строкой «нет типовой» (не как 0% отклонения), чтобы пробел справочника был виден."""
    if threshold_pct is None:
        threshold_pct = float(await config_value(db, "rate_deviation_threshold_pct", 20) or 20)
    profile = await get_enterprise_profile(db)
    rates = list((await db.execute(
        select(SupportRate).where(SupportRate.is_active.is_(True)).order_by(SupportRate.line)
    )).scalars().all())
    rows: list[RateDeviationOut] = []
    without = 0
    for r in rates:
        ref = await typical_rate(db, line=r.line, executor_type=r.executor_type)
        own = float(r.rate_per_hour)
        base = dict(rate_id=r.id, system_id=r.system_id, line=r.line, executor_type=r.executor_type,
                    vendor=r.vendor, rate_per_hour=own)
        if ref is None or not float(ref.value):
            without += 1
            rows.append(RateDeviationOut(**base, note="нет типовой ставки в справочнике"))
            continue
        dev = round((own - float(ref.value)) / float(ref.value) * 100, 1)
        if abs(dev) <= threshold_pct:
            continue
        rows.append(RateDeviationOut(
            **base, typical_rate=float(ref.value), typical_source=ref.source,
            typical_observed_on=ref.observed_on, deviation_pct=dev,
            note=f"{'дороже' if dev > 0 else 'дешевле'} типовой на {abs(dev)}%",
        ))
    rows.sort(key=lambda x: abs(x.deviation_pct) if x.deviation_pct is not None else -1, reverse=True)
    return RateDeviationsOut(threshold_pct=threshold_pct, size_class=profile.size_class,
                             rows=rows, without_reference=without)


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
