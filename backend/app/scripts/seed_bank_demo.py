"""seed_bank_demo.py — ЕДИНЫЙ демонстрационный набор данных банковского масштаба.

ЗАЧЕМ. Показ АСОК ИС на трёх системах и суммах в тысячи рублей не убеждает: контур, который
считает деньги под риском, читается только на реальном порядке величин. Этот сид наполняет
ВСЕ домены, куда вносятся данные, одним связным набором масштаба банка из топ-3 РФ:

    профиль организации · ИТ-ландшафт (24 ИС) · бизнес-процессы и стоимость их простоя ·
    ставки сопровождения · рыночные бенчмарки · финпараметры контура ·
    8 кварталов оценок качества по всем 31 подхарактеристике ГОСТ 25010 ·
    профессиональные суждения · технические сбои с экономикой · база рисков ·
    рисковые события со связями (ТС ↔ подхарактеристика ↔ мера) · меры с CAPEX/OPEX/ΔALE ·
    несоответствия на всех стадиях воронки · направления производства · оценка СИИ

ЧЕСТНОСТЬ ДАННЫХ. Организация условная, сотрудники вымышлены, цифры — расчётные от публичных
порядков величин (см. bank_demo/scale.py), а не выгрузка чьей-либо отчётности. Все записи
помечены `created_by="bank_demo"`, поэтому повторный запуск удаляет ровно свои данные и не
трогает то, что внесли руками.

ПОЧЕМУ ОТДЕЛЬНЫЙ СИД, А НЕ ПРАВКА seed_demo. seed_demo — компактный набор на 4 ИС для отладки
и тестов (на него опираются backend/tests/test_seed_scenarios.py). Показ и отладка требуют
разного объёма, и смешивать их в одном скрипте значит ломать тесты каждой правкой демо-контента.

ЗАПУСК (в Docker-стеке):

    docker compose exec backend python -m app.scripts.seed_bank_demo

Идемпотентно: повторный запуск пересоздаёт набор с нуля.
"""
import asyncio
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select

from app.infrastructure.database import AsyncSessionLocal
from app.modules.assessment.models import (
    AiAssessmentValue,
    AiWeight,
    AssessmentPeriod,
    AssessmentValue,
    ProfessionalJudgment,
)
from app.modules.econ.service import compute_incident_cost
from app.modules.econ.models import (
    EconConfig,
    BusinessProcess,
    BusinessProcessCost,
    EnterpriseProfile,
    MarketBenchmark,
    SupportRate,
    SystemBusinessProcess,
    SystemBusinessProcess as SysBp,
)
from app.modules.governance.economics_service import recompute_economics
from app.modules.governance.models import MeasureDepartment, Proposal
from app.modules.incidents.models import TechIncident
from app.modules.nonconformity import service as nc_service
from app.modules.nonconformity.models import Nonconformity
from app.modules.nonconformity.schemas import DecideIn, NonconformityCreate
from app.modules.quality import MetricCatalog, calculate_metric, map_to_level
from app.modules.quality.models import ScoreHistorySnapshot
from app.modules.reporting.models import DefectMatrix, QualityPlanMatrix, RiskMatrix
from app.modules.risk.event_service import recompute_ale
from app.modules.risk.models import (
    RiskBase,
    RiskEvent,
    RiskEventIncident,
    RiskEventMeasure,
    RiskEventSubchar,
)
from app.modules.systems import CriticalityClass, LifecycleStatus, System

from app.scripts.bank_demo import operations as ops
from app.scripts.bank_demo import scale
from app.scripts.bank_demo.landscape import (
    BUSINESS_PROCESSES,
    OWNERS,
    SYSTEMS,
)
from app.scripts.bank_demo.quality_profiles import (
    BASE_B,
    QUARTERS,
    UNMEASURABLE,
    target_x,
)

#: Метка авторства: по ней сид удаляет ровно свои записи при пересеве.
MARK = "bank_demo"

#: Профиль организации — ровно одна строка на установку (ТЗ v19 п.8, УК-21).
ENTERPRISE_NAME = "Демо-банк (профиль масштаба топ-3 РФ)"


# ═══════════════════════════ 1. Профиль, справочники, финпараметры ═══════════════════════════

async def seed_profile_and_refs(db) -> None:
    """Профиль организации, ставки сопровождения, бизнес-процессы, бенчмарки, направления."""
    # Профиль: size_class=LARGE по месту в рэнкинге банков (для банков 209-ФЗ неприменим —
    # ст. 4 ч. 3 прямо исключает кредитные организации из МСП, см. EnterpriseProfile).
    profile = (await db.execute(select(EnterpriseProfile))).scalars().first()
    if profile is None:
        profile = EnterpriseProfile(id=uuid.uuid4())
        db.add(profile)
    profile.name = ENTERPRISE_NAME
    profile.size_class = "LARGE"
    profile.revenue_annual = scale.BANK_OPERATING_INCOME_RUB
    profile.headcount = scale.BANK_HEADCOUNT
    profile.industry = "Банковская деятельность"
    profile.region = "Российская Федерация"
    profile.note = (
        "Демонстрационный профиль. Величины рассчитаны от публичных порядков банка первой тройки "
        f"(активы ~{scale.BANK_ASSETS_RUB // 10**12} трлн ₽, клиентов ~{scale.BANK_CLIENTS_MLN} млн); "
        "это не выгрузка отчётности конкретной организации."
    )

    # Ставки сопровождения: полная стоимость часа линии (ФОТ × накладные / полезный фонд).
    db.add_all([
        SupportRate(line="L1", executor_type="INTERNAL", rate_per_hour=scale.RATE_L1,
                    k_evening=1.5, k_weekend=2.0),
        SupportRate(line="L2", executor_type="INTERNAL", rate_per_hour=scale.RATE_L2,
                    k_evening=1.5, k_weekend=2.0),
        SupportRate(line="L3", executor_type="INTERNAL", rate_per_hour=scale.RATE_L3,
                    k_evening=1.5, k_weekend=2.0),
        SupportRate(line="L3", executor_type="VENDOR", vendor="Вендор ядра АБС", mode="EMERGENCY",
                    rate_per_hour=scale.RATE_VENDOR_L3_EMERGENCY, k_evening=1.0, k_weekend=1.0),
    ])

    # Направления производства — адресаты мер. Справочник ведётся по ХАРАКТЕРИСТИКЕ
    # (§17.3, УК-47): условное деление до интеграции с оргструктурой.
    dept_by_char = {
        "Функциональная пригодность": "Разработка ядра и платежей",
        "Производительность": "Инфраструктура и эксплуатация",
        "Совместимость": "Данные и интеграции",
        "Удобство использования": "Цифровые каналы",
        "Надёжность": "Инфраструктура и эксплуатация",
        "Защищённость": "Информационная безопасность",
        "Сопровождаемость": "Разработка ядра и платежей",
        "Переносимость": "Инфраструктура и эксплуатация",
    }
    for characteristic, department in dept_by_char.items():
        db.add(MeasureDepartment(characteristic=characteristic, department_name=department))

    # Финпараметры контура под масштаб организации: горизонт ИТ-инвестиции банка — три года,
    # ставка дисконтирования — ключевая плюс премия за риск проекта. Значения редактируются
    # через API без релиза, здесь только первичная установка под демо-профиль.
    for key, value, note in (
        ("rosi_horizon_months", scale.ROSI_HORIZON_MONTHS,
         "Горизонт ROSI, мес — типовой горизонт ИТ-инвестиции банка (демо-профиль)."),
        ("discount_rate_annual", scale.DISCOUNT_RATE_ANNUAL,
         "Ставка дисконтирования, доля/год — ключевая ставка плюс премия за риск (демо-профиль)."),
    ):
        cfg = await db.get(EconConfig, key)
        if cfg is None:
            cfg = EconConfig(key=key)
            db.add(cfg)
        cfg.value = value
        cfg.description = note

    # Рыночные бенчмарки: источник и дата обязательны — без них цифра неотличима от выдуманной.
    observed = datetime(2026, 6, 30, tzinfo=timezone.utc).date()
    db.add_all([
        MarketBenchmark(kind="SUPPORT_RATE_PER_HOUR", dimension="INTERNAL", company_size_class="LARGE",
                        value=3_900, unit="₽/час", source="Обзор рынка ИТ-услуг (демо-набор)",
                        observed_on=observed, note="Средняя внутренняя ставка сопровождения по крупным банкам"),
        MarketBenchmark(kind="SUPPORT_RATE_PER_HOUR", dimension="VENDOR", company_size_class="LARGE",
                        value=19_500, unit="₽/час", source="Обзор рынка ИТ-услуг (демо-набор)",
                        observed_on=observed, note="Вендорская линия L3 по контрактам сопровождения"),
        MarketBenchmark(kind="BP_COST_PER_MIN", dimension="FRONTAL", company_size_class="LARGE",
                        value=1_800_000, unit="₽/мин", source="Отраслевая оценка простоя (демо-набор)",
                        observed_on=observed, note="Фронтальный выручкообразующий процесс"),
        MarketBenchmark(kind="BP_COST_PER_MIN", dimension="BACKOFFICE", company_size_class="LARGE",
                        value=35_000, unit="₽/мин", source="Отраслевая оценка простоя (демо-набор)",
                        observed_on=observed, note="Бэк-офисный процесс"),
    ])
    await db.commit()


async def seed_landscape(db) -> dict[str, System]:
    """ИТ-ландшафт: системы с владельцами и вендорами. Возвращает карту код → System."""
    systems: dict[str, System] = {}
    for code, name, crit, owner, vendor, kind in SYSTEMS:
        found = (await db.execute(select(System).where(System.code == code))).scalars().first()
        if found is None:
            found = System(code=code, name=name, criticality_class=crit,
                           status_lc=LifecycleStatus.OE, system_kind=kind)
            db.add(found)
            await db.flush()
        found.name = name
        found.criticality_class = crit
        found.system_kind = kind
        found.owner = owner
        found.vendor = vendor
        found.is_active = True
        found.is_deleted = False
        systems[code] = found
    await db.commit()

    # Бизнес-процессы, стоимость минуты простоя и связь ИС ↔ БП с долей вклада.
    for code, name, kind, carriers in BUSINESS_PROCESSES:
        bp = BusinessProcess(code=code, name=name, kind=kind)
        db.add(bp)
        await db.flush()
        db.add(BusinessProcessCost(business_process_id=bp.id, method="RESOURCE",
                                   cost_per_min_base=scale.BP_COST_PER_MIN[code]))
        for sys_code, share in carriers:
            if sys_code in systems:
                db.add(SysBp(system_id=systems[sys_code].id, business_process_id=bp.id, share=share))
    await db.commit()
    return systems


# ═══════════════════════════ 2. Оценки качества и суждения ═══════════════════════════

def judgment_text(system_name: str, characteristic: str, sub: str, score_pct: int, owner: str) -> str:
    """Профсуждение по схеме «факт → влияние → мера → ответственный/срок».

    Схема не украшение: без влияния и ответственного суждение не отличается от жалобы, а по
    нему принимается решение о деньгах.
    """
    return (
        f"Факт: «{sub}» по характеристике «{characteristic}» ИС «{system_name}» — {score_pct}%. "
        f"Влияние: показатель ниже целевого уровня, риск переходит в операционные потери. "
        f"Мера: вынести на разбор с владельцем системы, оценить стоимость устранения. "
        f"Ответственный: {owner}. Срок: следующий отчётный квартал."
    )


async def seed_quality(db, systems: dict[str, System]) -> None:
    """8 кварталов оценок по всем подхарактеристикам + профсуждения по просевшим."""
    metrics = list((await db.execute(
        select(MetricCatalog).where(MetricCatalog.is_active.is_(True))
    )).scalars().all())
    if not metrics:
        raise RuntimeError(
            "Каталог метрик пуст — сначала выполните `python -m app.scripts.seed_metrics`."
        )

    for code, system in systems.items():
        for q_idx, quarter in enumerate(QUARTERS):
            period = AssessmentPeriod(system_id=system.id, period=quarter, status="CALCULATED")
            db.add(period)
            await db.flush()

            for metric in metrics:
                formula = (metric.formula_type.value
                           if hasattr(metric.formula_type, "value") else str(metric.formula_type))
                if (code, metric.subcharacteristic) in UNMEASURABLE:
                    db.add(AssessmentValue(
                        id=uuid.uuid4(), period_id=period.id, metric_id=metric.id,
                        val_a=None, val_b=None, calculated_x=None, quality_level=None,
                        unmeasurable=True, data_source=MARK,
                        expert_comment="Нет базы измерения B: источник данных не подключён.",
                    ))
                    continue

                x = target_x(code, metric.characteristic, metric.subcharacteristic, q_idx)
                b = BASE_B.get(metric.characteristic, 500)
                a = round(b * x) if formula == "DIRECT" else round(b * (1 - x))
                real_x = calculate_metric(a, b, formula)
                db.add(AssessmentValue(
                    id=uuid.uuid4(), period_id=period.id, metric_id=metric.id,
                    val_a=a, val_b=b, calculated_x=real_x, quality_level=map_to_level(real_x),
                    unmeasurable=False, data_source=MARK,
                ))

                # Профсуждение — только по последнему кварталу и только по реально просевшим
                # показателям: суждение на каждой строке обесценивает сам инструмент.
                if q_idx == len(QUARTERS) - 1 and real_x < 0.45:
                    owner = system.owner or "владелец системы"
                    db.add(ProfessionalJudgment(
                        period_id=period.id,
                        characteristic=metric.characteristic,
                        subcharacteristic=metric.subcharacteristic,
                        judgment_text=judgment_text(
                            system.name, metric.characteristic, metric.subcharacteristic,
                            round(real_x * 100), owner,
                        ),
                        author=MARK,
                    ))
        await db.commit()


# ═══════════════════════════ 3. Надёжность: техсбои ═══════════════════════════

async def seed_incidents(db, systems: dict[str, System]) -> dict[str, list[TechIncident]]:
    """Техсбои с экономическим слоем.

    Возвращает карту заголовок → ВСЕ реализации этого сбоя. Повторы (ops.RECURRENCE) нужны не
    для объёма: годовую частоту ARO движок считает по числу реализаций в окне наблюдения, и без
    повторов у отказа ЦОД и у ежеквартальной деградации выходит одинаковый ARO = 1.
    """
    created: dict[str, list[TechIncident]] = {}
    for item in ops.INCIDENTS:
        system = systems.get(item["system"])
        if system is None:
            continue
        occurrences: list[TechIncident] = []
        for repeat in range(ops.repeats_of(item["title"]) + 1):
            # Повторы сдвигаются НАЗАД от исходной даты, чтобы попасть в окно наблюдения ITSM.
            occurred = item["at"] - timedelta(days=ops.RECURRENCE_STEP_DAYS * repeat)
            # У прошлых реализаций простой короче: их разбирали, и часть выводов уже применена.
            downtime = round(float(item["downtime"]) * (1.0 - 0.08 * repeat), 2)
            inc = TechIncident(
                system_id=system.id, system_name=system.name,
                category=item["category"], severity=item["severity"],
                title=item["title"] if repeat == 0 else f"{item['title']} (повтор {repeat})",
                occurred_at=occurred,
                resolved_at=ops.resolved_at(occurred, downtime),
                # Момент устранения ПЕРВОПРИЧИНЫ отстоит от восстановления сервиса — этот разрыв
                # и есть метрика зрелости процесса (§2.1), поэтому он задан явно.
                root_cause_fixed_at=occurred + timedelta(days=9, minutes=downtime),
                incident_type=item["type"], degradation_type=item.get("degradation"),
                downtime_minutes=downtime, k_impact=item["k"],
                t_reaction_min=6, t_resolution_min=downtime, t_target_min=30,
                labor_l1_hours=item["l1"], labor_l2_hours=item["l2"], labor_l3_hours=item["l3"],
                vendor_involved=item["vendor"],
                root_cause=item["root"], admission_cause=item["admission"],
                preventive_measures=item["prevent"], responsible_unit=item["unit"],
                release_ref=item.get("release"), category_custom=item.get("category_custom"),
                source="import", created_by=MARK,
            )
            db.add(inc)
            occurrences.append(inc)
        created[item["title"]] = occurrences
    await db.commit()

    # C_ТС считаем сразу по всем сбоям, а не только по привязанным к рисковым событиям:
    # в реестре надёжности колонка стоимости иначе пустая у большинства строк, и разговор
    # «сколько нам стоил этот сбой» упирается в прочерк.
    for occurrences in created.values():
        for inc in occurrences:
            await compute_incident_cost(db, inc)
    await db.commit()
    return created


# ═══════════════════════════ 4. Риски: база, события, связи ═══════════════════════════

async def seed_risks(db, systems: dict[str, System],
                     incidents: dict[str, list[TechIncident]]) -> dict[str, RiskEvent]:
    """База рисков (каталог знаний) и рисковые события с числовым ALE."""
    base_by_code: dict[str, RiskBase] = {}
    for item in ops.RISK_BASE:
        rb = RiskBase(
            code=item["code"], title=item["title"], category=item["category"],
            characteristic=item["characteristic"], subcharacteristic=item["sub"],
            description=item["description"], consequence=item["consequence"],
            mitigation=item["mitigation"], severity=item["severity"], likelihood=item["likelihood"],
            source=MARK, created_by=MARK,
        )
        db.add(rb)
        base_by_code[item["code"]] = rb
    await db.commit()

    events: dict[str, RiskEvent] = {}
    for item in ops.RISK_EVENTS:
        system = systems.get(item["system"])
        ev = RiskEvent(
            code=item["code"], title=item["title"], category=item["category"],
            owner=item["owner"], system_id=system.id if system else None,
            risk_base_id=base_by_code[item["risk_base"]].id,
            regulatory=item.get("regulatory", False),
            risk_appetite=scale.RISK_APPETITE_ANNUAL,
            created_by=MARK,
        )
        # Экспертные ARO/SLE — там, где статистики нет и быть не должно (утечка ПДн), либо
        # где событие реализуется непрерывно (накопление техдолга), а не отдельными сбоями.
        if item.get("aro") is not None:
            ev.aro = item["aro"]
            ev.aro_is_expert = True
        if item.get("sle") is not None:
            ev.sle_expert = item["sle"]
        elif item.get("regulatory") and not item.get("incidents"):
            ev.sle_expert = scale.RISK_REGULATORY_SLE
        db.add(ev)
        await db.flush()

        for characteristic, sub in item["subchars"]:
            db.add(RiskEventSubchar(risk_event_id=ev.id, characteristic=characteristic,
                                    subcharacteristic=sub))
        # К событию привязываются ВСЕ реализации сбоя, включая повторы: именно их число
        # даёт движку годовую частоту ARO.
        for title in item["incidents"]:
            for inc in incidents.get(title, []):
                db.add(RiskEventIncident(risk_event_id=ev.id, incident_id=inc.id))
        events[item["code"]] = ev
    await db.commit()

    # ALE считает движок по привязанным реализациям — руками его задавать нельзя, иначе
    # получится цифра, которую система не умеет объяснить.
    for ev in events.values():
        await recompute_ale(db, ev)
    await db.commit()
    return events


# ═══════════════════════════ 5. Меры и несоответствия ═══════════════════════════

#: К какому рисковому событию относится мера — связь нужна для ΔALE и маршрутизации.
MEASURE_TO_RISK = {
    "Автоматическое переключение ЦОД для платёжного контура": "RE-2026-001",
    "Ёмкостное расширение очереди подтверждений": "RE-2026-002",
    "Канареечное развёртывание процессинга с автооткатом": "RE-2026-003",
    "Пересмотр прав доступа к клиентским данным по принципу минимума": "RE-2026-004",
    "Программа рефакторинга кредитного конвейера": "RE-2026-007",
    "Деградационный режим при недоступности БКИ": "RE-2026-005",
    "Эталонный набор проверок регуляторных форм": "RE-2026-006",
}


async def seed_measures(db, systems: dict[str, System],
                        events: dict[str, RiskEvent]) -> dict[str, Proposal]:
    """Меры качества с экономикой, решениями и исполнением."""
    created: dict[str, Proposal] = {}
    now = datetime.now(timezone.utc)
    for item in ops.MEASURES:
        system = systems.get(item["system"])
        owner = item["owner"]
        role = OWNERS.get(owner, ("руководитель", ""))[0]
        due_parts = item["due"].split(".")
        due_on = datetime(int(due_parts[2]), int(due_parts[1]), int(due_parts[0]), tzinfo=timezone.utc)

        # ΔALE выводится из ПОСЧИТАННОГО ALE связанного события, а не задаётся отдельно.
        #
        # Иначе набор рассыпается: мера «снимает» больше, чем событие стоит, ROSI выходит
        # бессмысленным, и первый же вопрос ЛПР «откуда эта экономия» остаётся без ответа.
        # `removal_share` — какую долю годовой стоимости риска мера действительно убирает:
        # устраняющая бьёт в первопричину и снимает больше, компенсирующая только смягчает.
        risk_code = MEASURE_TO_RISK.get(item["title"])
        linked = events.get(risk_code) if risk_code else None
        share = item.get("removal_share")
        if linked is not None and share:
            # Предотвращённый штраф — тоже кассовый эффект: это несостоявшийся отток денег,
            # а не отложенная выгода. Раскладывать его в «отложенный» значит обнулить ROSI и
            # показать обязательную по регуляторике меру как полностью убыточную.
            delta_cash = float(linked.ale_avg or 0) * share
            delta_deferred = 0.0
            delta_capacity = 0.0
        else:
            # Мера без связанного события (миграция архива и т.п.) — эффект задан вручную.
            delta_cash = item["delta_cash"]
            delta_deferred = item["delta_deferred"]
            delta_capacity = item["delta_capacity"]

        p = Proposal(
            system_id=system.id if system else None,
            system_name=system.name if system else item["system"],
            characteristic=item["characteristic"], metric_name=item["metric"],
            risk_title=item["title"], rationale=item["rationale"], expectation=item["expectation"],
            owner=owner, owner_role=role, department=item["department"],
            due_date=item["due"], due_on=due_on,
            status=item["status"],
            measure_type=item["type"],
            capex=item["capex"], opex_per_year=item["opex"],
            implementation_months=item["months"],
            delta_ale_cash=delta_cash, delta_ale_deferred=delta_deferred,
            delta_ale_capacity=delta_capacity,
            effort_hours=item.get("effort_hours"),
            effort_hours_set_at=now if item.get("effort_hours") else None,
            create_risk=True, is_demo=False, created_by=MARK,
        )
        if item["status"] in ("APPROVED", "REJECTED"):
            p.decided_by = "CIO Орлов А.В."
            p.decided_at = now - timedelta(days=30)
            p.decision_comment = item.get(
                "decision_comment",
                "Одобрено: эффект подтверждён связанными рисковыми событиями.",
            )
        if item.get("execution"):
            p.execution = item["execution"]
            p.executed_by = owner
            p.executed_at = now - timedelta(days=7)
            p.execution_comment = "Мера выполнена, эффект подтверждён на следующем периоде."
            # Факт по бюджету расходится с планом — так и бывает; контур обязан это показывать.
            p.actual_capex = round(item["capex"] * 1.08)
            p.actual_opex = round(item["opex"] * 0.95)
            p.actual_effort_hours = round(item.get("effort_hours", 0) * 1.12) or None
            p.actuals_set_at = now - timedelta(days=6)
        db.add(p)
        await db.flush()
        created[item["title"]] = p

        if linked is not None:
            db.add(RiskEventMeasure(risk_event_id=linked.id, proposal_id=p.id,
                                    ale_reduction_share=share))
    await db.commit()

    # ROSI, окупаемость и рекомендуемый вердикт считает движок по связке «мера ↔ рисковые
    # события». Проставлять их руками нельзя: тогда на карточке меры окажется цифра, которую
    # система не сможет объяснить, а весь смысл контура — в объяснимости решения.
    for p_measure in created.values():
        await recompute_economics(db, p_measure)
    await db.commit()
    return created


async def seed_nonconformities(db, systems: dict[str, System],
                               measures: dict[str, Proposal]) -> None:
    """Несоответствия на всех стадиях воронки — от «выявлено» до «верифицировано»."""
    for item in ops.NONCONFORMITIES:
        system = systems.get(item["system"])
        nc = await nc_service.create(db, NonconformityCreate(
            system_name=system.name if system else item["system"],
            system_id=system.id if system else None,
            characteristic=item["characteristic"], subcharacteristic=item["sub"],
            owner=item["owner"], level=item["level"], evidence_type=item["evidence"],
            is_blocking=item.get("is_blocking", False),
        ), MARK)
        stage = item["stage"]
        if stage == "IDENTIFIED":
            continue

        nc = await nc_service.evaluate(db, nc, item["ale"], item["owner"])
        if stage == "EVALUATED":
            continue

        if stage == "ACCEPTED":
            # Принятие риска требует подписи ЛПР — без неё это не решение, а умолчание.
            await nc_service.decide(db, nc, DecideIn(verdict="ACCEPT", signed_by=item["signed_by"]),
                                    "cto")
            continue

        nc = await nc_service.decide(db, nc, DecideIn(verdict="ELIMINATE"), "cto")
        if stage == "DECIDED":
            continue

        measure = measures.get(item.get("measure_title", ""))
        if measure is None:
            continue
        nc = await nc_service.assign_measure(db, nc, measure.id, "manager")
        nc = await nc_service.start(db, nc, "manager")
        if stage == "IN_PROGRESS":
            continue

        nc = await nc_service.execute(db, nc, item["executed_by"],
                                      "Мера внедрена, результат зафиксирован на следующем периоде")
        if stage == "VERIFIED":
            # SoD: оценивал, исполнял и верифицировал — разные лица.
            await nc_service.verify(db, nc, item["verified_by"], 18.0)
    await db.commit()


# ═══════════════════════════ Очистка и запуск ═══════════════════════════

async def purge(db) -> None:
    """Удаляет ровно то, что посеял этот сид, — ручные данные не трогает."""
    await db.execute(delete(Nonconformity).where(Nonconformity.created_by.in_((MARK, "econ_seed"))))
    await db.execute(delete(RiskEventMeasure))
    await db.execute(delete(RiskEventIncident))
    await db.execute(delete(RiskEventSubchar))
    await db.execute(delete(RiskEvent).where(RiskEvent.created_by.in_((MARK, "econ_seed"))))
    await db.execute(delete(RiskBase).where(RiskBase.created_by == MARK))
    # Экономический контур прежнего компактного сида (econ_seed) убирается тоже: два набора
    # рисковых событий разного масштаба в одной базе дают бессмысленный портфельный ALE.
    await db.execute(delete(Proposal).where(Proposal.created_by.in_((MARK, "econ_seed"))))
    await db.execute(delete(TechIncident).where(TechIncident.created_by.in_((MARK, "econ_seed"))))
    await db.execute(delete(ProfessionalJudgment).where(ProfessionalJudgment.author == MARK))
    await db.execute(delete(AssessmentValue).where(AssessmentValue.data_source == MARK))
    await db.execute(delete(MeasureDepartment))
    await db.execute(delete(MarketBenchmark))
    await db.execute(delete(BusinessProcessCost))
    await db.execute(delete(SystemBusinessProcess))
    await db.execute(delete(SupportRate))
    await db.execute(delete(BusinessProcess))
    await db.commit()

    # Периоды систем ЭТОГО ландшафта убираются целиком, а не только осиротевшие.
    #
    # Причина: часть кодов ИС совпадает с компактным набором seed_demo (HR_PORTAL и др.), и там
    # уже есть периоды за те же кварталы. Пара (система, период) уникальна в БД, поэтому без
    # полной очистки повторный сев падал на конфликте уникальности. Набор банковского масштаба
    # — источник истины для показа: по своим системам он замещает то, что посеяно раньше.
    own_ids = (await db.execute(
        select(System.id).where(System.code.in_([code for code, *_ in SYSTEMS]))
    )).scalars().all()
    if own_ids:
        own_periods = (await db.execute(
            select(AssessmentPeriod.id).where(AssessmentPeriod.system_id.in_(own_ids))
        )).scalars().all()
        if own_periods:
            # Сначала ВСЁ, что ссылается на период, потом сам период. Список зависимых таблиц
            # взят из схемы (внешние ключи на assessment_periods), а не по памяти: пропуск любой
            # из них роняет сид на середине, оставляя базу в половинчатом состоянии.
            await db.execute(delete(AiAssessmentValue).where(AiAssessmentValue.period_id.in_(own_periods)))
            await db.execute(delete(AiWeight).where(AiWeight.period_id.in_(own_periods)))
            await db.execute(delete(AssessmentValue).where(AssessmentValue.period_id.in_(own_periods)))
            await db.execute(delete(ProfessionalJudgment).where(ProfessionalJudgment.period_id.in_(own_periods)))
            await db.execute(delete(ScoreHistorySnapshot).where(ScoreHistorySnapshot.period_id.in_(own_periods)))
            for matrix in (DefectMatrix, QualityPlanMatrix, RiskMatrix):
                await db.execute(delete(matrix).where(matrix.period_id.in_(own_periods)))
            await db.execute(delete(AssessmentPeriod).where(AssessmentPeriod.id.in_(own_periods)))
            await db.commit()


async def seed_all() -> None:
    async with AsyncSessionLocal() as db:
        print("· очистка предыдущего демо-набора…")
        await purge(db)

        print("· профиль организации, ставки, бенчмарки, направления…")
        await seed_profile_and_refs(db)

        print(f"· ИТ-ландшафт: {len(SYSTEMS)} ИС, {len(BUSINESS_PROCESSES)} бизнес-процессов…")
        systems = await seed_landscape(db)

        print(f"· оценки качества: {len(systems)} ИС × {len(QUARTERS)} кварталов…")
        await seed_quality(db, systems)

        print(f"· технические сбои: {len(ops.INCIDENTS)}…")
        incidents = await seed_incidents(db, systems)

        print(f"· риски: база {len(ops.RISK_BASE)}, событий {len(ops.RISK_EVENTS)}…")
        events = await seed_risks(db, systems, incidents)

        print(f"· меры качества: {len(ops.MEASURES)}…")
        measures = await seed_measures(db, systems, events)

        print(f"· несоответствия: {len(ops.NONCONFORMITIES)}…")
        await seed_nonconformities(db, systems, measures)

        portfolio = sum(float(e.ale_avg or 0) for e in events.values())
        print(
            "\nГотово. Демо-набор банковского масштаба посеян.\n"
            f"  Портфельный ALE: {portfolio:,.0f} ₽/год\n"
            f"  Стоимость минуты банка: {scale.BANK_COST_PER_MIN:,.0f} ₽/мин\n"
            "  Переключите тумблер «Демо / LLM» в шапке в положение LLM — дашборды читают БД."
            .replace(",", " ")
        )


if __name__ == "__main__":
    asyncio.run(seed_all())
