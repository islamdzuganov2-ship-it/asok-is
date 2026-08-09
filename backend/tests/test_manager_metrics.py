"""Тесты метрик эффективности руководителей (BL-007, задача 12 / §7.1) — диагностический режим.

Агрегация по владельцу поверх несоответствий и мер: нагрузка/просрочка/выполнено, ΔALE под
управлением, доля принятия риска и компенсирующих мер.
"""
from datetime import datetime, timezone

from app.modules.econ.manager_metrics_service import manager_metrics
from app.modules.governance.models import Proposal
from app.modules.nonconformity.models import (
    STATUS_DECIDED,
    STATUS_EVALUATED,
    STATUS_IDENTIFIED,
    STATUS_VERIFIED,
    Nonconformity,
)

PAST = datetime(2020, 1, 1, tzinfo=timezone.utc)


def _nc(owner="Иванов", **kw) -> Nonconformity:
    base = dict(system_name="АБС Core", characteristic="Надёжность",
                subcharacteristic="Отказоустойчивость", owner=owner, status=STATUS_IDENTIFIED)
    base.update(kw)
    return Nonconformity(**base)


async def test_manager_metrics_aggregate_by_owner(db_session):
    db_session.add_all([
        _nc(status=STATUS_VERIFIED, evaluated_ale=1_000_000, decision_verdict="ELIMINATE"),
        _nc(status=STATUS_EVALUATED, sla_due=PAST),                # открыт + просрочен
        _nc(status=STATUS_IDENTIFIED),                             # открыт
        _nc(status=STATUS_DECIDED, decision_verdict="ACCEPT"),     # открыт + решение «принять»
        Proposal(system_name="АБС Core", owner="Иванов", status="APPROVED",
                 execution="DONE", delta_ale_cash=500_000, measure_type="ELIMINATING"),
        Proposal(system_name="АБС Core", owner="Иванов", status="APPROVED",
                 due_date="2020-01-01"),                           # открыт + просрочен
        Proposal(system_name="АБС Core", owner="Иванов", status="PENDING_APPROVAL",
                 measure_type="COMPENSATING"),                     # открыт
    ])
    await db_session.commit()

    res = await manager_metrics(db_session)
    assert res.mode == "diagnostic"
    row = next(r for r in res.rows if r.owner == "Иванов")
    assert row.open_count == 5           # 3 нс + 2 меры
    assert row.overdue_count == 2        # нс EVALUATED past SLA + мера с прошедшим сроком
    assert row.completed_count == 2      # нс VERIFIED + мера DONE
    assert row.delta_ale_managed == 1_500_000.0   # 1M (нс) + 500k (мера)
    assert row.accept_share == 50.0      # из 2 решений одно «принять»
    assert row.compensating_share == 50.0  # из 2 мер одна компенсирующая
    assert row.avg_age_days is not None


async def test_manager_metrics_skips_ownerless_and_sorts_by_load(db_session):
    db_session.add_all([
        _nc(owner="Петров", status=STATUS_IDENTIFIED),
        _nc(owner="Петров", status=STATUS_IDENTIFIED),
        _nc(owner="Сидоров", status=STATUS_IDENTIFIED),
        _nc(owner="   ", status=STATUS_IDENTIFIED),   # без владельца — пропускается
    ])
    await db_session.commit()
    res = await manager_metrics(db_session)
    owners = [r.owner for r in res.rows]
    assert "Петров" in owners and "Сидоров" in owners
    assert all(o.strip() for o in owners)             # пустой владелец отфильтрован
    assert res.rows[0].owner == "Петров"              # сортировка по нагрузке (2 > 1)
