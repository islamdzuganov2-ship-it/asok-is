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
from app.modules.systems import CriticalityClass, System

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
        # --- Пользователи (все роли: аналитик, МК, топ-менеджмент) ---
        users_data = [
            {"username": "admin", "email": "admin@example.com", "password": "Admin123!", "role": "ADMIN"},
            {"username": "analyst", "email": "analyst@example.com", "password": "Analyst123!", "role": "TEST_ANALYST"},
            {"username": "manager", "email": "manager@example.com", "password": "Manager123!", "role": "QUALITY_MANAGER"},
            {"username": "cto", "email": "cto@example.com", "password": "Cto12345!", "role": "CTO"},
        ]
        for item in users_data:
            result = await db.execute(select(User).where(User.username == item["username"]))
            if result.scalar_one_or_none() is None:
                db.add(
                    User(
                        username=item["username"],
                        email=item["email"],
                        password_hash=get_password_hash(item["password"]),
                        full_name=item["username"].title(),
                        role=item["role"],
                    )
                )

        # --- Системы ---
        systems_data = [
            {"name": "АБС Core", "code": "ABS_CORE", "criticality_class": CriticalityClass.MISSION_CRITICAL},
            {"name": "CRM ОПК", "code": "CRM_OPK", "criticality_class": CriticalityClass.BUSINESS_CRITICAL},
            {"name": "HR Portal", "code": "HR_PORTAL", "criticality_class": CriticalityClass.BUSINESS_OPERATIONAL},
        ]
        systems: list[System] = []
        for item in systems_data:
            result = await db.execute(select(System).where(System.code == item["code"]))
            system = result.scalar_one_or_none()
            if system is None:
                system = System(**item)
                db.add(system)
                await db.flush()
            systems.append(system)

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

        # --- Сценарные оценки: 3 ИС × 6 кварталов × все метрики каталога ---
        for system in systems:
            code = system.code
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

        await db.commit()


if __name__ == "__main__":
    asyncio.run(seed_data())
