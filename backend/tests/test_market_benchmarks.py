"""Тесты структуры рыночных бенчмарков (ТЗ v19 п.9-10, В-30а) — без числового наполнения.

В-30а (какими открытыми источниками пользоваться) заказчиком НЕ решён: тесты проверяют, что
СТРУКТУРА держит инвариант «источник и дата обязательны» и что сравнение честно отвечает
«нет данных», а не подставляет ноль/выдуманное среднее, когда бенчмарка ещё нет (обычное
состояние — таблица пуста после миграции).
"""
from datetime import date

import pytest

from app.modules.econ import service
from app.modules.econ.models import (
    BENCHMARK_BP_COST,
    BENCHMARK_SUPPORT_RATE,
    BusinessProcess,
    BusinessProcessCost,
    SupportRate,
)
from app.modules.econ.schemas import EnterpriseProfileIn, MarketBenchmarkCreate
from app.shared.exceptions import NotFoundError, ValidationError
from pydantic import ValidationError as PydanticValidationError


def _benchmark(**kw) -> MarketBenchmarkCreate:
    base = dict(kind=BENCHMARK_BP_COST, dimension="BACKOFFICE", value=50.0, unit="₽/мин",
                source="Открытый отраслевой обзор, банк.ру, 2026", observed_on=date(2026, 6, 1))
    base.update(kw)
    return MarketBenchmarkCreate(**base)


# ─── Обязательность источника и даты (структурный инвариант) ──────────────────────────

def test_source_cannot_be_empty():
    with pytest.raises(PydanticValidationError):
        MarketBenchmarkCreate(kind=BENCHMARK_BP_COST, dimension="BACKOFFICE", value=50.0,
                              unit="₽/мин", source="", observed_on=date(2026, 6, 1))


def test_source_and_observed_on_are_required_fields():
    fields = MarketBenchmarkCreate.model_fields
    assert fields["source"].is_required()
    assert fields["observed_on"].is_required()


# ─── Валидация словарей (kind/dimension/company_size_class) ───────────────────────────

async def test_create_rejects_unknown_kind(db_session):
    with pytest.raises(ValidationError):
        await service.create_benchmark(db_session, _benchmark(kind="НЕИЗВЕСТНЫЙ"), None)


async def test_create_rejects_dimension_outside_bp_kinds(db_session):
    with pytest.raises(ValidationError):
        await service.create_benchmark(
            db_session, _benchmark(kind=BENCHMARK_BP_COST, dimension="НЕ_БП_ТИП"), None)


async def test_create_rejects_dimension_outside_executor_types_for_rate_kind(db_session):
    with pytest.raises(ValidationError):
        await service.create_benchmark(
            db_session, _benchmark(kind=BENCHMARK_SUPPORT_RATE, dimension="BACKOFFICE"), None)


async def test_create_rejects_unknown_size_class(db_session):
    with pytest.raises(ValidationError):
        await service.create_benchmark(
            db_session, _benchmark(company_size_class="ОГРОМНАЯ"), None)


async def test_create_succeeds_with_valid_data(db_session):
    row = await service.create_benchmark(db_session, _benchmark(), None)
    assert row.value == 50.0
    assert row.source


# ─── list_benchmarks: фильтр по kind ───────────────────────────────────────────────────

async def test_list_filters_by_kind(db_session):
    await service.create_benchmark(db_session, _benchmark(kind=BENCHMARK_BP_COST), None)
    await service.create_benchmark(
        db_session, _benchmark(kind=BENCHMARK_SUPPORT_RATE, dimension="INTERNAL"), None)
    only_bp = await service.list_benchmarks(db_session, kind=BENCHMARK_BP_COST)
    assert all(r.kind == BENCHMARK_BP_COST for r in only_bp)
    assert len(await service.list_benchmarks(db_session)) == 2


# ─── compare_business_process: честное «нет данных» на каждом уровне ──────────────────

async def test_compare_bp_unknown_id_raises(db_session):
    import uuid
    with pytest.raises(NotFoundError):
        await service.compare_business_process(db_session, uuid.uuid4())


async def test_compare_bp_without_cost_is_honest_not_zero(db_session):
    bp = BusinessProcess(code="BP-1", name="Обработка заявок", kind="BACKOFFICE")
    db_session.add(bp)
    await db_session.commit()
    out = await service.compare_business_process(db_session, bp.id)
    assert out.own_value is None
    assert out.benchmark is None
    assert "не рассчитана" in out.note


async def test_compare_bp_without_benchmark_is_honest_not_fabricated(db_session):
    bp = BusinessProcess(code="BP-2", name="Приём платежей", kind="FRONTAL")
    db_session.add(bp)
    await db_session.flush()
    db_session.add(BusinessProcessCost(business_process_id=bp.id, method="RESOURCE", cost_per_min_base=120.0))
    await db_session.commit()
    out = await service.compare_business_process(db_session, bp.id)
    assert out.own_value == 120.0
    assert out.benchmark is None
    assert "В-30а" in out.note


async def test_compare_bp_with_benchmark_computes_delta(db_session):
    bp = BusinessProcess(code="BP-3", name="Резервное копирование", kind="BACKGROUND")
    db_session.add(bp)
    await db_session.flush()
    db_session.add(BusinessProcessCost(business_process_id=bp.id, method="EXPERT", cost_per_min_base=110.0))
    await service.create_benchmark(
        db_session, _benchmark(kind=BENCHMARK_BP_COST, dimension="BACKGROUND", value=100.0), None)
    await db_session.commit()

    out = await service.compare_business_process(db_session, bp.id)
    assert out.own_value == 110.0
    assert out.benchmark is not None and out.benchmark.value == 100.0
    assert out.delta_pct == 10.0  # (110-100)/100*100
    assert "выше" in out.note


async def test_compare_bp_benchmark_picks_latest_by_date(db_session):
    """Несколько бенчмарков на один dimension — сравнение берёт САМЫЙ СВЕЖИЙ, не первый попавшийся."""
    bp = BusinessProcess(code="BP-4", name="Курьерская доставка", kind="FRONTAL")
    db_session.add(bp)
    await db_session.flush()
    db_session.add(BusinessProcessCost(business_process_id=bp.id, method="RESOURCE", cost_per_min_base=50.0))
    await service.create_benchmark(
        db_session, _benchmark(kind=BENCHMARK_BP_COST, dimension="FRONTAL", value=40.0,
                               observed_on=date(2025, 1, 1), source="Старый источник"), None)
    await service.create_benchmark(
        db_session, _benchmark(kind=BENCHMARK_BP_COST, dimension="FRONTAL", value=45.0,
                               observed_on=date(2026, 6, 1), source="Свежий источник"), None)
    await db_session.commit()

    out = await service.compare_business_process(db_session, bp.id)
    assert out.benchmark.value == 45.0
    assert out.benchmark.source == "Свежий источник"


# ─── compare_support_rate: размер компании — параметр подстановки (п.10) ──────────────

async def test_compare_rate_unknown_id_raises(db_session):
    import uuid
    with pytest.raises(NotFoundError):
        await service.compare_support_rate(db_session, uuid.uuid4())


async def test_compare_rate_without_benchmark_is_honest(db_session):
    rate = SupportRate(line="L2", executor_type="INTERNAL", rate_per_hour=1500.0)
    db_session.add(rate)
    await db_session.commit()
    out = await service.compare_support_rate(db_session, rate.id)
    assert out.own_value == 1500.0
    assert out.benchmark is None
    assert "В-30а" in out.note


async def test_compare_rate_matches_by_executor_type_and_company_size(db_session):
    await service.update_enterprise_profile(db_session, EnterpriseProfileIn(size_class="LARGE"), None)
    rate = SupportRate(line="L2", executor_type="VENDOR", rate_per_hour=2000.0)
    db_session.add(rate)
    # Бенчмарк под ДРУГОЙ размер компании — не должен подойти.
    await service.create_benchmark(
        db_session, _benchmark(kind=BENCHMARK_SUPPORT_RATE, dimension="VENDOR", value=1800.0,
                               company_size_class="SMALL"), None)
    # Бенчмарк под ПРАВИЛЬНЫЙ размер — должен подойти.
    await service.create_benchmark(
        db_session, _benchmark(kind=BENCHMARK_SUPPORT_RATE, dimension="VENDOR", value=1900.0,
                               company_size_class="LARGE"), None)
    await db_session.commit()

    out = await service.compare_support_rate(db_session, rate.id)
    assert out.benchmark is not None and out.benchmark.value == 1900.0
    assert out.delta_pct is not None
