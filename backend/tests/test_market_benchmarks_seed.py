"""Тесты сида рыночных бенчмарков source-данными (ТЗ v19 п.9-10, В-30а закрыт 16.08.2026,
см. docs/ТЗ_19_Управленческий_Контур_и_Веса.md §0, доп. к Р-7).

Проверяет: сид идемпотентен и не трогает уже введённые записи (в т.ч. вручную), каждая
сеяная строка проходит те же структурные инварианты (source/observed_on непусты), что и
ручной ввод, а сравнение ставки сопровождения честно откатывается на общий (не размерный)
ориентир, когда под конкретный company_size_class ничего не заведено — а не молчит «нет данных»
при наличии общего.
"""
from datetime import date

from app.modules.econ import service
from app.modules.econ.models import (
    BENCHMARK_BP_COST,
    BENCHMARK_SUPPORT_RATE,
    BP_KINDS,
    EXECUTOR_INTERNAL,
    EXECUTOR_VENDOR,
    MarketBenchmark,
    SupportRate,
)
from app.modules.econ.schemas import EnterpriseProfileIn, MarketBenchmarkCreate
from sqlalchemy import select


async def test_seed_inserts_expected_rows(db_session):
    added = await service.seed_market_benchmarks(db_session)
    assert added == 5  # 3× BP_COST (BACKOFFICE/FRONTAL/BACKGROUND) + 2× SUPPORT_RATE (INTERNAL/VENDOR)

    rows = list((await db_session.execute(select(MarketBenchmark))).scalars().all())
    assert len(rows) == 5
    for row in rows:
        assert row.source.strip()
        assert row.observed_on is not None
        assert row.value > 0


async def test_seed_covers_all_bp_kinds_with_same_aggregate_value(db_session):
    await service.seed_market_benchmarks(db_session)
    bp_rows = await service.list_benchmarks(db_session, kind=BENCHMARK_BP_COST)
    assert {r.dimension for r in bp_rows} == set(BP_KINDS)
    # Один агрегат на все типы БП (источник не делит по типу) — не три разных числа.
    assert {r.value for r in bp_rows} == {12_500.00}
    assert all("НЕ делит по типу" in r.note for r in bp_rows)


async def test_seed_covers_both_executor_types_without_company_size(db_session):
    await service.seed_market_benchmarks(db_session)
    rate_rows = await service.list_benchmarks(db_session, kind=BENCHMARK_SUPPORT_RATE)
    assert {r.dimension for r in rate_rows} == {EXECUTOR_INTERNAL, EXECUTOR_VENDOR}
    assert all(r.company_size_class is None for r in rate_rows)


async def test_seed_is_idempotent(db_session):
    first = await service.seed_market_benchmarks(db_session)
    second = await service.seed_market_benchmarks(db_session)
    assert first == 5
    assert second == 0
    rows = list((await db_session.execute(select(MarketBenchmark))).scalars().all())
    assert len(rows) == 5


async def test_seed_does_not_duplicate_manually_entered_row(db_session):
    """Аналитик уже завёл свой BACKOFFICE-бенчмарк вручную до старта сида — сид не должен
    добавить вторую строку под тот же (kind, dimension) поверх неё."""
    await service.create_benchmark(
        db_session,
        MarketBenchmarkCreate(
            kind=BENCHMARK_BP_COST, dimension="BACKOFFICE", value=999.0, unit="₽/мин",
            source="Ручной ввод аналитика", observed_on=date(2026, 1, 1),
        ),
        None,
    )
    added = await service.seed_market_benchmarks(db_session)
    # BACKOFFICE (BP_COST) уже занят вручную; остальные 4 — FRONTAL/BACKGROUND (BP_COST) и
    # INTERNAL/VENDOR (SUPPORT_RATE, другой kind, ручная запись их не блокирует) — досеиваются.
    assert added == 4

    bp_rows = await service.list_benchmarks(db_session, kind=BENCHMARK_BP_COST)
    backoffice = next(r for r in bp_rows if r.dimension == "BACKOFFICE")
    assert backoffice.value == 999.0  # ручная запись не перезаписана


# ─── compare_support_rate: откат на общий ориентир, когда размерного нет ──────────────

async def test_compare_rate_falls_back_to_general_benchmark_when_size_specific_missing(db_session):
    await service.seed_market_benchmarks(db_session)  # INTERNAL/VENDOR без company_size_class
    await service.update_enterprise_profile(db_session, EnterpriseProfileIn(size_class="LARGE"), None)
    rate = SupportRate(line="L2", executor_type="INTERNAL", rate_per_hour=600.0)
    db_session.add(rate)
    await db_session.commit()

    out = await service.compare_support_rate(db_session, rate.id)
    assert out.benchmark is not None
    assert out.benchmark.value == 516.26
    assert "не сегментирован" in out.note


async def test_compare_rate_prefers_size_specific_over_general_fallback(db_session):
    """Если для конкретного размера бенчмарк ЕСТЬ — используется он, а не общий откат."""
    await service.seed_market_benchmarks(db_session)  # общий VENDOR-ориентир без size_class
    await service.update_enterprise_profile(db_session, EnterpriseProfileIn(size_class="LARGE"), None)
    await service.create_benchmark(
        db_session,
        MarketBenchmarkCreate(
            kind=BENCHMARK_SUPPORT_RATE, dimension=EXECUTOR_VENDOR, company_size_class="LARGE",
            value=4_000.0, unit="₽/час", source="Отдельный source под LARGE",
            observed_on=date(2026, 7, 1),
        ),
        None,
    )
    rate = SupportRate(line="L3", executor_type="VENDOR", rate_per_hour=4_500.0)
    db_session.add(rate)
    await db_session.commit()

    out = await service.compare_support_rate(db_session, rate.id)
    assert out.benchmark.value == 4_000.0
    assert "не сегментирован" not in out.note


async def test_compare_rate_without_size_class_set_does_not_trigger_fallback_lookup(db_session):
    """Если у профиля size_class вообще не задан, прямой поиск (dimension, None) уже совпадает
    сам по себе — отдельная пометка про откат не нужна (это не откат, это обычный путь)."""
    await service.seed_market_benchmarks(db_session)
    rate = SupportRate(line="L1", executor_type="INTERNAL", rate_per_hour=550.0)
    db_session.add(rate)
    await db_session.commit()

    out = await service.compare_support_rate(db_session, rate.id)
    assert out.benchmark is not None
    assert "не сегментирован" not in out.note
