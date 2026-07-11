"""seed_incidents.py — демо-реестр технических сбоев (T-21) для аналитики надёжности.

Детерминированные сценарные сбои по 4 демо-ИС (согласовано с seed_demo v2): все 5 первопричин
представлены, MTTR варьируется, часть сбоев открыта (для демонстрации «открытые/закрытые»).
Идемпотентно: полностью пересевает таблицу tech_incidents.

Запуск: docker compose exec backend python -m app.scripts.seed_incidents
"""
import asyncio
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete

from app.infrastructure.database import AsyncSessionLocal
from app.modules.incidents.models import TechIncident


def _dt(y: int, m: int, d: int, h: int = 10) -> datetime:
    return datetime(y, m, d, h, 0, tzinfo=timezone.utc)


# (система, категория, критичность, заголовок, occurred, mttr_часы|None=открыт, первопричина, релиз)
INCIDENTS = [
    # АБС Core (MISSION CRITICAL) — инцидент P1 в Q4-2025 (совпадает с провалом «Надёжности» в оценке).
    ("АБС Core", "INFRASTRUCTURE", "critical", "Отказ контроллера СХД — недоступность ядра АБС",
     _dt(2025, 11, 15, 3), 6.0, "Выход из строя контроллера СХД; задержка автопереключения на резерв", None),
    ("АБС Core", "POWER", "high", "Просадка питания в основном ЦОД, переход на ИБП",
     _dt(2025, 11, 15, 3), 1.5, "Кратковременный сбой электроснабжения; ИБП отработал, но с деградацией", None),
    ("АБС Core", "NETWORK", "medium", "Потеря связности с процессинговым узлом",
     _dt(2026, 3, 4, 12), 2.0, "Обрыв основного канала; маршрутизация ушла на резервный с ростом задержек", None),

    # CRM ОПК (деградация) — регрессии после релизов + производительность.
    ("CRM ОПК", "RELEASE", "high", "Регрессия расчёта скидок после релиза 4.2",
     _dt(2026, 2, 10, 9), 20.0, "Некорректная миграция правил ценообразования в релизе; откат и хотфикс", "CRM 4.2.0"),
    ("CRM ОПК", "RELEASE", "medium", "Падение фонового обмена после релиза 4.3",
     _dt(2026, 4, 18, 14), 8.0, "Изменён контракт интеграции без версии; сломался коннектор", "CRM 4.3.1"),
    ("CRM ОПК", "PERFORMANCE", "high", "Деградация времени отклика в пиковые часы",
     _dt(2026, 5, 20, 11), None, "Неоптимальные запросы к БД и нехватка пула соединений при росте нагрузки", None),

    # HR Portal (рост качества) — единичные сетевые/инфраструктурные.
    ("HR Portal", "NETWORK", "low", "Кратковременная недоступность портала (DNS)",
     _dt(2026, 1, 22, 16), 0.5, "Ошибка в записи DNS при плановой смене провайдера", None),
    ("HR Portal", "INFRASTRUCTURE", "medium", "Переполнение диска сервиса вложений",
     _dt(2026, 4, 2, 8), 3.0, "Не настроена ротация файлов вложений; диск заполнен", None),

    # Скоринг-ML (СИИ) — производительность инференса.
    ("Скоринг-ML (СИИ)", "PERFORMANCE", "high", "Рост задержки инференса модели скоринга",
     _dt(2026, 5, 6, 13), None, "Увеличение размера признакового пространства без масштабирования узлов", None),
]


async def seed() -> None:
    async with AsyncSessionLocal() as db:
        await db.execute(delete(TechIncident))
        for system, category, severity, title, occurred, mttr, cause, release in INCIDENTS:
            db.add(TechIncident(
                system_name=system,
                category=category,
                severity=severity,
                title=title,
                description=None,
                root_cause=cause,
                release_ref=release,
                occurred_at=occurred,
                resolved_at=(occurred + timedelta(hours=mttr)) if mttr is not None else None,
                source="manual",
                created_by="seed",
            ))
        await db.commit()
        print(f"✅ Засеяно техсбоев: {len(INCIDENTS)} (открытых: {sum(1 for i in INCIDENTS if i[5] is None)})")


if __name__ == "__main__":
    asyncio.run(seed())
