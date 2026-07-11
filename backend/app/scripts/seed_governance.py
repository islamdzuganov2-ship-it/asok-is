"""seed_governance.py — сценарные меры качества (governance) в БД для LIVE-режима (T-10/T-15).

Наполняет контур governance реальными (не-демо) мерами по 4 демо-ИС, согласованными с seed_demo v2
и реестром техсбоев (seed_incidents): полный цикл петли (создана → решение топ-менеджмента →
исполнение/эскалация). Даёт данные для: реестра мер, меток мер на «Динамике качества» (T-15,
эффективность), риск-триггеров. Идемпотентно: пересевает таблицу proposals.

NB: is_demo=False — это «реальные» для live-режима меры (в live фронт скрывает только is_demo=True).
Запуск: docker compose exec backend python -m app.scripts.seed_governance
"""
import asyncio
from datetime import datetime, timezone

from sqlalchemy import delete

from app.infrastructure.database import AsyncSessionLocal
from app.modules.governance.models import Proposal


def _dt(y: int, m: int, d: int) -> datetime:
    return datetime(y, m, d, 10, 0, tzinfo=timezone.utc)


# Сценарные меры (полный цикл governance-петли по 4 ИС).
MEASURES = [
    dict(
        system_name="АБС Core", characteristic="Надёжность", metric_name="Доступность системы",
        calculated_score=72, calculated_level="Ниже среднего",
        rationale="Инцидент P1 в Q4-2025: отказ контроллера СХД, недоступность ядра АБС.",
        expectation="Зарезервировать узлы СХД, отработать процедуры автопереключения на резерв.",
        owner="Иванов И.И.", owner_role="Руководитель эксплуатации", due_date="2026-03-01",
        status="APPROVED", decided_by="admin", decided_at=_dt(2025, 12, 20),
        decision_comment="Согласовано, критичная ИС — приоритет.",
        execution="DONE", execution_comment="Узлы зарезервированы, процедуры переключения отработаны.",
        executed_by="manager", executed_at=_dt(2026, 2, 15),
        created_at=_dt(2025, 12, 1), created_by="manager",
    ),
    dict(
        system_name="CRM ОПК", characteristic="Функциональная пригодность", metric_name="Функциональная полнота",
        calculated_score=51, calculated_level="Ниже среднего",
        rationale="Деградация функциональной пригодности 73%→51%: регрессии после релизов 4.2/4.3.",
        expectation="Стабилизировать релизный процесс, усилить регрессионное тестирование.",
        owner="Петров П.П.", owner_role="Руководитель разработки", due_date="2026-08-01",
        status="PENDING_APPROVAL", create_risk=True, risk_title="Систематическая деградация функциональности CRM",
        created_at=_dt(2026, 5, 25), created_by="manager",
    ),
    dict(
        system_name="CRM ОПК", characteristic="Сопровождаемость", metric_name="Тестируемость",
        calculated_score=44, calculated_level="Ниже среднего",
        rationale="Низкое покрытие автотестами → регрессии проходят в продуктив.",
        expectation="Поднять автоматизацию регрессии, включить контроль покрытия в релизный гейт.",
        owner="Сидорова А.А.", owner_role="Руководитель QA", due_date="2026-04-01",
        status="APPROVED", decided_by="admin", decided_at=_dt(2026, 2, 1),
        escalated=True, escalation_reason="Срыв срока: ресурс QA-автоматизации не выделен.",
        escalation_decision="REQUEST_MEASURES", escalation_decision_comment="Выделить 2 инженеров автоматизации.",
        escalation_decided_by="admin",
        created_at=_dt(2026, 1, 20), created_by="manager",
    ),
    dict(
        system_name="HR Portal", characteristic="Функциональная пригодность", metric_name="Функциональная корректность",
        calculated_score=77, calculated_level="Выше среднего",
        rationale="Программа качества дала рост 51%→77%: закрыты разрывы функционального покрытия.",
        expectation="Закрепить результат, поддерживать покрытие критических сценариев.",
        owner="Кузнецов К.К.", owner_role="Владелец продукта", due_date="2026-02-01",
        status="APPROVED", decided_by="admin", decided_at=_dt(2025, 11, 10),
        execution="DONE", execution_comment="Разрывы покрытия закрыты, метрика выросла.",
        executed_by="manager", executed_at=_dt(2026, 1, 25),
        created_at=_dt(2025, 11, 1), created_by="manager",
    ),
    dict(
        system_name="Скоринг-ML (СИИ)", characteristic="Производительность", metric_name="Время отклика",
        calculated_score=58, calculated_level="Средний уровень",
        rationale="Рост задержки инференса модели скоринга при увеличении признакового пространства.",
        expectation="Масштабировать узлы инференса, оптимизировать пайплайн признаков.",
        owner="Морозов М.М.", owner_role="ML-инженер", due_date="2026-09-01",
        status="PENDING_APPROVAL", created_at=_dt(2026, 5, 10), created_by="manager",
    ),
    dict(
        system_name="АБС Core", characteristic="Сопровождаемость", metric_name="Модульность",
        calculated_score=40, calculated_level="Ниже среднего",
        rationale="Монолитная связанность ядра усложняет изменения.",
        expectation="Поэтапная декомпозиция монолита (запрос ресурса на архитектурный рефакторинг).",
        owner="Иванов И.И.", owner_role="Главный архитектор", due_date="2026-12-01",
        status="REJECTED", decided_by="admin", decided_at=_dt(2026, 3, 15),
        decision_comment="Отклонено на текущий год: нет ресурса, вернуться в план на след. год.",
        created_at=_dt(2026, 3, 1), created_by="manager",
    ),
]


async def seed() -> None:
    async with AsyncSessionLocal() as db:
        await db.execute(delete(Proposal))
        for m in MEASURES:
            db.add(Proposal(**m))
        await db.commit()
        pend = sum(1 for m in MEASURES if m["status"] == "PENDING_APPROVAL")
        print(f"✅ Засеяно мер governance: {len(MEASURES)} (ожидают решения: {pend})")


if __name__ == "__main__":
    asyncio.run(seed())
