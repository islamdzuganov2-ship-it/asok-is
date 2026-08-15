"""seed_demo.py — качественные демо-данные БД с ролевым подходом (v2, 2026-07).

Пересоздаёт «нагенерированные» данные оценок с нуля (детерминированно, без random):
старые AUTO_SEED-значения удаляются, вместо одного квартала со случайными числами —
6 кварталов (Q1-2025…Q2-2026) со СЦЕНАРНЫМИ профилями качества по каждой ИС.

Ролевой подход к данным:
  • Менеджер по качеству — метрики (A, B, X, формула), уровни, профессиональные суждения
    по проблемным подхарактеристикам (факт → влияние → мера → ответственный/срок → эскалация);
    у CRM ОПК часть суждений намеренно не заполнена — для уведомлений «заполните суждение».
  • CIO/CTO/CEO — агрегаты для управленческих решений: динамика интегрального качества,
    аномальные кварталы (инцидент, деградация, эффект программы качества), поводы для
    мер/эскалаций. Данные согласованы: те же таблицы читают все дашборды
    (/assessments/dashboard, /reports/executive-dashboard).

Сценарии:
  АБС Core   (MISSION CRITICAL)   — стабильно высокое качество; Q4-2025 просадка «Надёжности»
                                    (инцидент P1) с восстановлением — кейс аномалии для CIO.
  CRM ОПК    (BUSINESS CRITICAL)  — плавная деградация функциональной пригодности и
                                    сопровождаемости — кейс для мер и задач повышения качества.
  HR Portal  (BUSINESS OPERATIONAL) — рост после программы качества; две метрики «невозможно
                                    измерить» (нет базы B) — честная картина для отчётности.

Запуск: python -m app.scripts.seed_demo  (внутри контейнера backend).
"""
import asyncio
import hashlib
import uuid
from datetime import datetime, timezone

from sqlalchemy import delete, select

from app.infrastructure.database import AsyncSessionLocal
from app.modules.assessment.models import (
    AiAssessmentValue,
    AssessmentPeriod,
    AssessmentValue,
    ExpertJudgmentHistory,
    ProfessionalJudgment,
)
from app.modules.iam import User, get_password_hash
from app.modules.quality import MetricCatalog, calculate_metric, map_to_level
from app.modules.quality.ai_calculation import compute_metric, normalize_to_baseline
from app.modules.quality.ai_quality_model import AI_QUALITY_MODEL
from app.modules.systems import CriticalityClass, System
# BL-007 риск-экономический контур: справочники, ТС с экономикой, рисковые события, несоответствия.
from app.modules.econ.models import (
    BusinessProcess,
    BusinessProcessCost,
    SupportRate,
    SystemBusinessProcess,
)
from app.modules.governance.models import Proposal
from app.modules.incidents.models import TechIncident
from app.modules.nonconformity import service as nc_service
from app.modules.nonconformity.models import Nonconformity
from app.modules.nonconformity.schemas import DecideIn, NonconformityCreate
from app.modules.risk.event_service import recompute_ale
from app.modules.risk.models import RiskEvent, RiskEventIncident, RiskEventSubchar

QUARTERS = ["Q1-2025", "Q2-2025", "Q3-2025", "Q4-2025", "Q1-2026", "Q2-2026"]

# Мусорные/сгенерированные системы прошлых сессий: мягко удаляются (is_deleted, is_active=False).
# 30 демо-имён зеркалили фронтовые моки (seed_scale) — в БД они не нужны: демо-режим живёт
# на фронте, БД хранит только реальные сценарии.
JUNK_SYSTEM_NAMES = {
    "й", "какая то система", "тестовый проект", "QA CALC diag", "QA Невозм", "QA Тест Система",
    "АБС «Ядро»", "ДБО Розница", "ДБО Корпоратив", "Единое хранилище данных (ЕХД)",
    "Systematica Radius", "СЭД", "Процессинг карт", "Антифрод-платформа", "Кредитный конвейер",
    "Скоринг-движок", "Витрина отчётности", "КХД Аналитика", "Мобильный банк", "Интернет-эквайринг",
    "Платёжный шлюз", "АБС Казначейство", "Депозитарий", "Биллинг услуг", "KYC/AML-модуль",
    "Бюро кредитных историй", "Шина интеграции (ESB)", "Портал самообслуживания", "Контакт-центр",
    "HR-платформа", "Документооборот ВНД", "Риск-менеджмент", "Бухгалтерия ГК",
    "Архив долговременный", "Мониторинг ИТ (NOC)",
}

# Сценарий: base — качество в Q1-2025, trend — изменение за квартал,
# chars — смещение по характеристике, anomalies — разовый сдвиг (характеристика, квартал).
SCENARIOS: dict[str, dict] = {
    "ABS_CORE": {
        "base": 0.86, "trend": 0.0,
        "chars": {"Надёжность": -0.04, "Производительность": -0.03},
        "anomalies": {("Надёжность", "Q4-2025"): -0.30, ("Производительность", "Q1-2026"): 0.08},
    },
    "CRM_OPK": {
        "base": 0.74, "trend": -0.045,
        "chars": {"Функциональная пригодность": -0.10, "Сопровождаемость": -0.12, "Защищённость": 0.08},
        "anomalies": {("Функциональная пригодность", "Q3-2025"): -0.15},
    },
    "HR_PORTAL": {
        "base": 0.50, "trend": 0.05,
        "chars": {"Удобство использования": 0.10, "Надёжность": -0.05},
        "anomalies": {("Надёжность", "Q2-2026"): 0.14},
    },
    # АОКИС — собственная система оценки качества: сильный кейс по «Функциональной пригодности»
    # (карточка «Заполненные профсуждения — АОКИС» связана с этой характеристикой, ТЗ v14 §4).
    "AOKIS": {
        "base": 0.78, "trend": 0.01,
        "chars": {"Функциональная пригодность": -0.18, "Сопровождаемость": 0.05},
        "anomalies": {("Функциональная пригодность", "Q1-2026"): -0.12},
    },
}

# Метрики «невозможно измерить» (нет базы B) — только у HR Portal.
UNMEASURABLE: set[tuple[str, str]] = {
    ("HR_PORTAL", "Неотказуемость"),
    ("HR_PORTAL", "Ёмкость (пропускная способность)"),
}

# Реалистичные объёмы базы B по характеристикам (тесты, требования, инциденты, запросы…).
BASE_B: dict[str, int] = {
    "Функциональная пригодность": 120,
    "Производительность": 200,
    "Совместимость": 45,
    "Удобство использования": 80,
    "Надёжность": 90,
    "Защищённость": 60,
    "Сопровождаемость": 150,
    "Переносимость": 40,
}

# Ответственные по характеристикам (тот же ролевой словарь, что во фронтовых моках).
OWNER_BY_CHAR: dict[str, str] = {
    "Функциональная пригодность": "руководитель разработки Петрова А.С.",
    "Производительность": "руководитель эксплуатации Сидоров К.М.",
    "Совместимость": "архитектор решений Николаев Д.А.",
    "Удобство использования": "руководитель разработки Петрова А.С.",
    "Надёжность": "руководитель эксплуатации Сидоров К.М.",
    "Защищённость": "руководитель ИБ Смирнов В.П.",
    "Сопровождаемость": "руководитель тестирования Козлова Е.В.",
    "Переносимость": "архитектор решений Николаев Д.А.",
}

ESCALATE_BY_CRIT = {
    CriticalityClass.MISSION_CRITICAL: "CIO",
    CriticalityClass.BUSINESS_CRITICAL: "CTO",
    CriticalityClass.BUSINESS_OPERATIONAL: "руководитель ИТ-блока",
}


def _jitter(key: str, spread: float = 0.06) -> float:
    """Детерминированный сдвиг подхарактеристики в [-spread, +spread] (стабилен между запусками)."""
    h = int(hashlib.sha256(key.encode("utf-8")).hexdigest()[:8], 16)
    return (h / 0xFFFFFFFF - 0.5) * 2 * spread


def _clamp(v: float, lo: float = 0.02, hi: float = 0.99) -> float:
    return min(hi, max(lo, v))


def target_x(code: str, characteristic: str, sub: str, q_idx: int) -> float:
    """Целевое значение X метрики по сценарию системы."""
    sc = SCENARIOS[code]
    x = sc["base"] + sc["trend"] * q_idx
    x += sc["chars"].get(characteristic, 0.0)
    x += sc["anomalies"].get((characteristic, QUARTERS[q_idx]), 0.0)
    x += _jitter(f"{code}|{sub}")
    return _clamp(x)


def judgment_text(system_name: str, characteristic: str, sub: str, pct: int,
                  crit: CriticalityClass) -> str:
    """Суждение МК: факт → влияние → мера → ответственный/срок → эскалация."""
    owner = OWNER_BY_CHAR.get(characteristic, "руководитель ИТ-блока Иванов И.И.")
    esc = ESCALATE_BY_CRIT[crit]
    if pct >= 80:
        return (
            f"Подхарактеристика «{sub}» = {pct}% — целевой уровень выдержан. "
            f"Существенных отклонений по «{system_name}» не выявлено; контроль в плановом режиме, "
            f"ответственный — {owner}."
        )
    if pct >= 60:
        return (
            f"Подхарактеристика «{sub}» = {pct}% — ниже целевого уровня (80%). "
            f"Влияние: умеренный риск по характеристике «{characteristic}» для «{system_name}». "
            f"Мера: включить доработки в план следующего квартала. Ответственный — {owner}. "
            f"Контроль — менеджер по качеству."
        )
    return (
        f"Подхарактеристика «{sub}» = {pct}% — критично ниже целевого уровня. "
        f"Влияние: высокий риск по характеристике «{characteristic}» для «{system_name}» "
        f"({crit.value}). Мера: первоочередные работы с выделением ресурса, ответственный — {owner}, "
        f"срок — следующий квартал. При срыве срока — эскалация на уровень {esc}."
    )


async def seed_data() -> None:
    async with AsyncSessionLocal() as db:
        # --- Пользователи: по одному на КАЖДУЮ роль ролевой модели (User.ALL_ROLES) ---
        # Полный набор нужен, чтобы проверять SoD (BL-007): владелец риска (RISK_MANAGER)
        # ведёт реестр, но не меняет Score; аудитор-верификатор (AUDITOR) подтверждает меры.
        # CTO/CEO — только чтение (User.READONLY_ROLES). Посев идемпотентен: существующие
        # логины не трогаются, добавляются только недостающие.
        users_data = [
            {"username": "superadmin", "email": "superadmin@example.com", "password": "Super123!", "role": "SUPER_ADMIN"},
            {"username": "admin", "email": "admin@example.com", "password": "Admin123!", "role": "ADMIN"},
            {"username": "analyst", "email": "analyst@example.com", "password": "Analyst123!", "role": "TEST_ANALYST"},
            {"username": "manager", "email": "manager@example.com", "password": "Manager123!", "role": "QUALITY_MANAGER"},
            {"username": "cto", "email": "cto@example.com", "password": "Cto12345!", "role": "CTO"},
            {"username": "ceo", "email": "ceo@example.com", "password": "Ceo12345!", "role": "CEO"},
            {"username": "risk", "email": "risk@example.com", "password": "Risk123!", "role": "RISK_MANAGER"},
            {"username": "auditor", "email": "auditor@example.com", "password": "Auditor123!", "role": "AUDITOR"},
            # ДЕФ-10: ФИО совпадает с ответственным в демо-наборе мер (mockScaleData: OWNER_BY_CHAR),
            # иначе «Мои задачи» у исполнителя пусты и сценарий нечем показать.
            {"username": "executor", "email": "executor@example.com", "password": "Executor123!",
             "role": "EXECUTOR", "full_name": "Петрова А.С."},
        ]
        assert {u["role"] for u in users_data} == set(User.ALL_ROLES), "seed users must cover all roles"
        for item in users_data:
            result = await db.execute(select(User).where(User.username == item["username"]))
            if result.scalar_one_or_none() is None:
                db.add(
                    User(
                        username=item["username"],
                        email=item["email"],
                        password_hash=get_password_hash(item["password"]),
                        full_name=item.get("full_name") or item["username"].title(),
                        role=item["role"],
                    )
                )

        # --- Мягкое удаление мусорных систем прошлых сессий ---
        junk = (await db.execute(select(System).where(System.name.in_(JUNK_SYSTEM_NAMES)))).scalars().all()
        for s in junk:
            s.is_deleted = True
            s.is_active = False

        # --- Системы (сценарные) ---
        systems_data = [
            {"name": "АБС Core", "code": "ABS_CORE", "criticality_class": CriticalityClass.MISSION_CRITICAL},
            {"name": "CRM ОПК", "code": "CRM_OPK", "criticality_class": CriticalityClass.BUSINESS_CRITICAL},
            {"name": "HR Portal", "code": "HR_PORTAL", "criticality_class": CriticalityClass.BUSINESS_OPERATIONAL},
            {"name": "АОКИС", "code": "AOKIS", "criticality_class": CriticalityClass.BUSINESS_CRITICAL},
        ]
        # (ключ сценария, система) — ключом служит код из systems_data, даже если в БД другой code.
        systems: list[tuple[str, System]] = []
        for item in systems_data:
            result = await db.execute(
                select(System).where((System.code == item["code"]) | (System.name == item["name"]))
            )
            found = list(result.scalars().all())
            system = next((s for s in found if s.code == item["code"]), found[0] if found else None)
            if system is None:
                system = System(**item)
                db.add(system)
                await db.flush()
            else:
                system.is_deleted = False
                system.is_active = True
            # Дубли по имени (мок-сев прошлых сессий) — мягко удаляем, чтобы не задваивать дашборды.
            for dup in found:
                if dup.id != system.id:
                    dup.is_deleted = True
                    dup.is_active = False
            systems.append((item["code"], system))

        metrics = list((await db.execute(select(MetricCatalog).where(MetricCatalog.is_active.is_(True)))).scalars().all())
        if not metrics:
            await db.commit()
            return

        # --- Полная очистка нагенерированных данных оценок (пересев с нуля) ---
        await db.execute(delete(ExpertJudgmentHistory))
        await db.execute(delete(ProfessionalJudgment))
        await db.execute(delete(AiAssessmentValue))   # оценки СИИ (ГОСТ 59898) тоже ссылаются на периоды
        await db.execute(delete(AssessmentValue))
        await db.execute(delete(AssessmentPeriod))

        # --- Сценарные оценки: 4 ИС × 6 кварталов × все метрики каталога ---
        for code, system in systems:
            for q_idx, quarter in enumerate(QUARTERS):
                period = AssessmentPeriod(system_id=system.id, period=quarter, status="CALCULATED")
                db.add(period)
                await db.flush()

                for metric in metrics:
                    formula_type = (
                        metric.formula_type.value if hasattr(metric.formula_type, "value") else str(metric.formula_type)
                    )
                    if (code, metric.subcharacteristic) in UNMEASURABLE:
                        db.add(AssessmentValue(
                            id=uuid.uuid4(), period_id=period.id, metric_id=metric.id,
                            val_a=None, val_b=None, calculated_x=None, quality_level=None,
                            unmeasurable=True, data_source="SCENARIO_SEED",
                            expert_comment="Нет базы измерения B: источник данных не подключён.",
                        ))
                        continue

                    x = target_x(code, metric.characteristic, metric.subcharacteristic, q_idx)
                    b = BASE_B.get(metric.characteristic, 100)
                    a = round(b * x) if formula_type == "DIRECT" else round(b * (1 - x))
                    real_x = calculate_metric(a, b, formula_type)
                    db.add(AssessmentValue(
                        id=uuid.uuid4(), period_id=period.id, metric_id=metric.id,
                        val_a=a, val_b=b, calculated_x=real_x,
                        quality_level=map_to_level(real_x), data_source="SCENARIO_SEED",
                    ))

                # --- Профессиональные суждения МК: только последний квартал ---
                if quarter != QUARTERS[-1]:
                    continue
                for j, metric in enumerate(metrics):
                    if (code, metric.subcharacteristic) in UNMEASURABLE:
                        continue
                    x = target_x(code, metric.characteristic, metric.subcharacteristic, q_idx)
                    pct = round(x * 100)
                    # Суждения нужны по проблемным зонам (< 80%); высокие — короткая фиксация нормы.
                    if pct >= 80 and code != "ABS_CORE":
                        continue  # у CRM/HR суждения только по проблемам
                    # У CRM ОПК каждое 3-е суждение намеренно НЕ заполнено → уведомление МК.
                    if code == "CRM_OPK" and j % 3 == 0:
                        continue
                    db.add(ProfessionalJudgment(
                        period_id=period.id,
                        characteristic=metric.characteristic,
                        subcharacteristic=metric.subcharacteristic,
                        judgment_text=judgment_text(
                            system.name, metric.characteristic, metric.subcharacteristic, pct,
                            system.criticality_class,
                        ),
                        author="Менеджер по качеству",
                    ))

        # --- Контур СИИ (ГОСТ 59898): «Скоринг-ML (СИИ)», представительный набор Q2-2026 ---
        await seed_ai_contour(db)

        await db.commit()


def _ai_inputs(kind: str, x: float) -> dict:
    """Реалистичные входы метрики СИИ под целевое значение x (матрица ошибок 1000 примеров)."""
    if kind in ("ACCURACY", "PRECISION", "RECALL", "SPECIFICITY", "F1"):
        tp = round(500 * x)
        tn = round(500 * min(0.99, x + 0.03))
        return {"TP": tp, "FN": 500 - tp, "TN": tn, "FP": 500 - tn}
    if kind == "RATIO_DIRECT":
        return {"A": round(80 * x), "B": 80}
    if kind == "RATIO_INVERSE":
        return {"A": round(80 * (1 - x)), "B": 80}
    if kind == "EXPERT_SCALE":
        return {"score": round(x * 100)}
    return {}


async def seed_ai_contour(db) -> None:
    """Пересев данных модуля качества СИИ: система, период Q2-2026, значения по набору."""
    result = await db.execute(select(System).where(System.name == "Скоринг-ML (СИИ)"))
    ai_system = result.scalars().first()
    if ai_system is None:
        ai_system = System(
            name="Скоринг-ML (СИИ)", code="SCORING_ML_AI",
            criticality_class=CriticalityClass.BUSINESS_CRITICAL,
        )
        db.add(ai_system)
        await db.flush()
    ai_system.system_kind = "AI"
    ai_system.is_deleted = False
    ai_system.is_active = True

    period = AssessmentPeriod(system_id=ai_system.id, period="Q2-2026", status="COMPLETE")
    db.add(period)
    await db.flush()

    # Представительный набор: до 2 субхарактеристик на характеристику (E1-виды).
    e1_kinds = {"RATIO_DIRECT", "RATIO_INVERSE", "ACCURACY", "PRECISION", "RECALL", "SPECIFICITY", "F1", "EXPERT_SCALE"}
    for group_name, chars in AI_QUALITY_MODEL:
        for char_name, subs in chars:
            taken = 0
            for sub_name, kind, _is_ai, _hint in subs:
                if kind not in e1_kinds or taken >= 2:
                    continue
                x = _clamp(0.86 + _jitter(f"AI|{sub_name}", 0.10), 0.55, 0.98)
                inputs = _ai_inputs(kind, x)
                raw = compute_metric(kind, inputs)
                if raw is None:
                    continue
                # Классификационные метрики сверяются с эталоном 0.88 (±0.10) —
                # часть строк осознанно вне допуска (кейс для отчёта соответствия).
                baseline = 0.88 if kind not in ("EXPERT_SCALE",) else None
                tol_low, tol_high = (0.10, 0.10) if baseline is not None else (None, None)
                normalized, conformant = normalize_to_baseline(raw, baseline, tol_low, tol_high)
                db.add(AiAssessmentValue(
                    id=uuid.uuid4(), period_id=period.id,
                    group_name=group_name, characteristic=char_name, subcharacteristic=sub_name,
                    metric_kind=kind, inputs=inputs,
                    baseline=baseline, tol_low=tol_low, tol_high=tol_high,
                    raw_value=raw, normalized_x=normalized, conformant=conformant,
                ))
                taken += 1


async def seed_econ_contour() -> None:
    """Демо-данные риск-экономического контура (BL-007): справочники (ставки, БП+стоимость),
    техсбои с экономикой, рисковые события с расчётом ALE через движок, несоответствия по стадиям
    жизненного цикла (для воронки замкнутости). Идемпотентно — чистит свои строки (created_by).
    Запускается ПОСЛЕ seed_data (нужны системы) и после старта приложения (нужен сид econ_config)."""
    async with AsyncSessionLocal() as db:
        systems = {s.name: s for s in (await db.execute(select(System))).scalars().all()}
        abs_core, crm, hr = systems.get("АБС Core"), systems.get("CRM ОПК"), systems.get("HR Portal")
        if abs_core is None:
            return  # нет сценарных систем — seed_data ещё не отработал

        # --- Идемпотентная очистка (в FK-безопасном порядке) ---
        await db.execute(delete(Nonconformity).where(Nonconformity.created_by == "econ_seed"))
        await db.execute(delete(RiskEvent).where(RiskEvent.created_by == "econ_seed"))  # links каскадом (ondelete)
        await db.execute(delete(TechIncident).where(TechIncident.created_by == "econ_seed"))
        await db.execute(delete(Proposal).where(Proposal.created_by == "econ_seed"))
        await db.execute(delete(BusinessProcessCost))
        await db.execute(delete(SystemBusinessProcess))
        await db.execute(delete(SupportRate))
        await db.execute(delete(BusinessProcess))
        await db.commit()

        # --- 1. Ставки сопровождения (смешанная модель §2.4): внутренние L1-L3 + вендорская L3 ---
        db.add_all([
            SupportRate(line="L1", executor_type="INTERNAL", rate_per_hour=1200),
            SupportRate(line="L2", executor_type="INTERNAL", rate_per_hour=2000),
            SupportRate(line="L3", executor_type="INTERNAL", rate_per_hour=3500),
            SupportRate(line="L3", executor_type="VENDOR", vendor="Acme Support", mode="EMERGENCY",
                        rate_per_hour=5000),
        ])

        # --- 2. Бизнес-процессы + стоимость минуты простоя + связь ИС↔БП ---
        async def add_bp(code, name, kind, cost_per_min, system, share=1.0):
            bp = BusinessProcess(code=code, name=name, kind=kind)
            db.add(bp)
            await db.flush()
            db.add(BusinessProcessCost(business_process_id=bp.id, method="RESOURCE",
                                       cost_per_min_base=cost_per_min))
            if system is not None:
                db.add(SystemBusinessProcess(system_id=system.id, business_process_id=bp.id, share=share))
            return bp

        await add_bp("BP-PAY", "Приём платежей", "FRONTAL", 5000, abs_core)      # фронтальный — дорогой простой
        if crm is not None:
            await add_bp("BP-SALES", "Продажи (CRM)", "FRONTAL", 1500, crm)
        if hr is not None:
            await add_bp("BP-HR", "Кадровый учёт", "BACKOFFICE", 200, hr)         # бэк-офис — дёшево
        await db.commit()

        # --- 3. Техсбои с экономикой (ТС = реализации риска), рабочее время → K_время=1.0 ---
        def incident(system, title, category, occurred, downtime, k, l2, l3, itype="DOWNTIME", deg=None):
            return TechIncident(
                system_id=system.id, system_name=system.name, category=category, severity="high",
                title=title, occurred_at=occurred,
                resolved_at=occurred.replace(hour=occurred.hour + 1),
                incident_type=itype, degradation_type=deg, downtime_minutes=downtime, k_impact=k,
                labor_l2_hours=l2, labor_l3_hours=l3, t_reaction_min=10, t_resolution_min=downtime,
                vendor_involved=(l3 > 0), source="import", created_by="econ_seed",
            )
        inc_abs1 = incident(abs_core, "Отказ узла кластера БД → простой приёма платежей",
                            "INFRASTRUCTURE", datetime(2026, 2, 2, 11, 0, tzinfo=timezone.utc), 45, 1.0, 3, 1)
        inc_abs2 = incident(abs_core, "Деградация отклика на пике оплаты",
                            "PERFORMANCE", datetime(2026, 5, 4, 14, 0, tzinfo=timezone.utc), 90, 0.5, 2, 0,
                            itype="DEGRADATION", deg="PERFORMANCE")
        seeded_incidents = [inc_abs1, inc_abs2]
        if crm is not None:
            seeded_incidents.append(incident(
                crm, "Сбой интеграции CRM → недоступность продаж", "NETWORK",
                datetime(2026, 3, 2, 10, 0, tzinfo=timezone.utc), 60, 1.0, 2, 1))
        db.add_all(seeded_incidents)
        await db.commit()

        # --- 4. Рисковые события + связи (подхарактеристика/ТС) + расчёт ALE движком ---
        re_abs = RiskEvent(code="RE-ABS-001", title="Отказ узла кластера → простой приёма платежей",
                           category="Отказоустойчивость", owner="Риск-менеджер Орлов А.В.",
                           system_id=abs_core.id, created_by="econ_seed")
        db.add(re_abs)
        await db.flush()
        db.add_all([
            RiskEventSubchar(risk_event_id=re_abs.id, characteristic="Надёжность",
                             subcharacteristic="Отказоустойчивость"),
            RiskEventIncident(risk_event_id=re_abs.id, incident_id=inc_abs1.id),
            RiskEventIncident(risk_event_id=re_abs.id, incident_id=inc_abs2.id),
        ])
        # Регуляторный риск (КИИ/187-ФЗ) с экспертным ARO — кейс вето независимо от частоты (§3.2).
        re_reg = RiskEvent(code="RE-SEC-001", title="Компрометация данных (КИИ) — регуляторный риск",
                           category="Защищённость", owner="Руководитель ИБ Смирнов В.П.",
                           system_id=abs_core.id, aro=0.5, aro_is_expert=True, sle_expert=20_000_000,
                           regulatory=True, created_by="econ_seed")
        db.add(re_reg)
        await db.flush()
        db.add(RiskEventSubchar(risk_event_id=re_reg.id, characteristic="Защищённость",
                                subcharacteristic="Целостность"))
        await db.commit()
        # Пересчёт ALE через движок (C_ТС по привязанным ТС × ARO).
        for ev in (re_abs, re_reg):
            await recompute_ale(db, ev)

        # --- 5. Несоответствия по стадиям жизненного цикла (для воронки замкнутости §3.3) ---
        # Демо-мера, чтобы довести одно несоответствие до «Верифицировано» (нужен proposal_id).
        measure = Proposal(system_name=abs_core.name, characteristic="Надёжность",
                           rationale="Кластеризация БД (N+1) для устранения SPOF",
                           status="APPROVED", measure_type="ELIMINATING", capex=4_000_000,
                           opex_per_year=600_000, implementation_months=4, is_demo=True,
                           created_by="econ_seed")
        db.add(measure)
        await db.commit()
        await db.refresh(measure)

        # NC1 — полный цикл до «Верифицировано» (SoD: оценивал/исполнял/верифицировал — разные лица).
        nc1 = await nc_service.create(db, NonconformityCreate(
            system_name=abs_core.name, characteristic="Надёжность", subcharacteristic="Отказоустойчивость",
            owner="Сидоров К.М.", level="MAJOR", evidence_type="B"), "econ_seed")
        nc1 = await nc_service.evaluate(db, nc1, 3_200_000, "Сидоров К.М.")
        nc1 = await nc_service.decide(db, nc1, DecideIn(verdict="ELIMINATE"), "cto")
        nc1 = await nc_service.assign_measure(db, nc1, measure.id, "manager")
        nc1 = await nc_service.start(db, nc1, "manager")
        nc1 = await nc_service.execute(db, nc1, "Петров А.С.", "Кластер развёрнут, SPOF устранён")
        await nc_service.verify(db, nc1, "Аудитор Козлова Е.В.", 15.0)

        # NC2 — принятый риск (ACCEPT с подписью и датой пересмотра).
        nc2 = await nc_service.create(db, NonconformityCreate(
            system_name=(crm.name if crm else abs_core.name), characteristic="Производительность",
            subcharacteristic="Временные характеристики", owner="Николаев Д.А.", level="MINOR",
            evidence_type="A"), "econ_seed")
        nc2 = await nc_service.evaluate(db, nc2, 1_500_000, "Николаев Д.А.")
        await nc_service.decide(db, nc2, DecideIn(verdict="ACCEPT", signed_by="CIO Орлов А.В."), "cto")

        # NC3 — оценено, решения ещё нет (SLA-таймер идёт).
        nc3 = await nc_service.create(db, NonconformityCreate(
            system_name=abs_core.name, characteristic="Защищённость", subcharacteristic="Целостность",
            owner="Смирнов В.П.", level="MAJOR", evidence_type="E"), "econ_seed")
        await nc_service.evaluate(db, nc3, 800_000, "Смирнов В.П.")

        # NC4, NC5 — только выявлено (одно критическое-блокирующее на Mission Critical).
        await nc_service.create(db, NonconformityCreate(
            system_name=abs_core.name, characteristic="Надёжность", subcharacteristic="Восстанавливаемость",
            owner="Сидоров К.М.", level="CRITICAL", is_blocking=True, evidence_type="B"), "econ_seed")
        await nc_service.create(db, NonconformityCreate(
            system_name=(crm.name if crm else abs_core.name), characteristic="Сопровождаемость",
            subcharacteristic="Анализируемость", owner="Козлова Е.В.", level="MINOR",
            evidence_type="C"), "econ_seed")


if __name__ == "__main__":
    async def _main() -> None:
        await seed_data()
        await seed_econ_contour()
    asyncio.run(_main())
