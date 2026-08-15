"""Тесты домена incidents (T-21): CRUD техсбоев + аналитика надёжности на сервисном слое."""
from datetime import datetime, timedelta, timezone

import pytest

from app.modules.incidents import service
from app.modules.incidents.schemas import (
    IncidentImportRow,
    ResolveIn,
    TechIncidentCreate,
    TechIncidentUpdate,
)
from app.shared.exceptions import NotFoundError, ValidationError

BASE = datetime(2026, 5, 1, 10, 0, tzinfo=timezone.utc)


def _new(system="АБС Core", category="INFRASTRUCTURE", severity="high", **kw) -> TechIncidentCreate:
    data = dict(system_name=system, category=category, severity=severity,
                title="Сбой", occurred_at=BASE,
                # T-36: обязательные поля ручного ввода (source=manual по умолчанию).
                root_cause="RCA", admission_cause="контроль не сработал",
                responsible_unit="Эксплуатация", preventive_measures="ввести проверку")
    data.update(kw)
    return TechIncidentCreate(**data)


async def test_create_validates_category_and_severity(db_session):
    with pytest.raises(ValidationError):
        await service.create(db_session, _new(category="UNKNOWN"), "manager")
    with pytest.raises(ValidationError):
        await service.create(db_session, _new(severity="urgent"), "manager")
    inc = await service.create(db_session, _new(), "manager")
    assert inc.category == "INFRASTRUCTURE" and inc.created_by == "manager"


async def test_create_requires_manual_fields(db_session):
    # T-36: ручной ввод (source=manual) требует корневую причину, причину допущения,
    # виновное направление и меры по неповторению.
    for miss in ("root_cause", "admission_cause", "responsible_unit", "preventive_measures"):
        with pytest.raises(ValidationError):
            await service.create(db_session, _new(**{miss: None}), "manager")
    # Импорт/ITSM — мягкая проверка: те же пропуски допустимы.
    inc = await service.create(db_session, _new(source="import", root_cause=None,
                                                admission_cause=None, responsible_unit=None,
                                                preventive_measures=None), "importer")
    assert inc.source == "import"


async def test_create_other_requires_custom(db_session):
    # T-37: первопричина «Другое» требует текст новой первопричины.
    with pytest.raises(ValidationError):
        await service.create(db_session, _new(category="OTHER"), "manager")
    inc = await service.create(db_session, _new(category="OTHER", category_custom="человеческий фактор"), "manager")
    assert inc.category == "OTHER" and inc.category_custom == "человеческий фактор"


async def test_list_filters(db_session):
    await service.create(db_session, _new(system="АБС Core", category="NETWORK"), "m")
    await service.create(db_session, _new(system="CRM ОПК", category="RELEASE",
                                          resolved_at=BASE + timedelta(hours=3)), "m")
    assert len(await service.list_incidents(db_session)) == 2
    assert len(await service.list_incidents(db_session, system="АБС Core")) == 1
    assert len(await service.list_incidents(db_session, category="RELEASE")) == 1
    assert len(await service.list_incidents(db_session, status="open")) == 1       # без resolved_at
    assert len(await service.list_incidents(db_session, status="resolved")) == 1


async def test_resolve_sets_timestamp(db_session):
    inc = await service.create(db_session, _new(), "m")
    assert inc.resolved_at is None
    inc = await service.resolve(db_session, inc, ResolveIn(resolved_at=BASE + timedelta(hours=5)).resolved_at)
    assert inc.resolved_at == BASE + timedelta(hours=5)


async def test_update_validates(db_session):
    inc = await service.create(db_session, _new(), "m")
    with pytest.raises(ValidationError):
        await service.update(db_session, inc, TechIncidentUpdate(category="BAD"))
    inc = await service.update(db_session, inc, TechIncidentUpdate(severity="critical"))
    assert inc.severity == "critical"


async def test_analytics_aggregates(db_session):
    # 3 сбоя: 2 RELEASE (один закрыт за 2ч, один открыт), 1 NETWORK закрыт за 4ч.
    await service.create(db_session, _new(system="АБС Core", category="RELEASE",
                                          resolved_at=BASE + timedelta(hours=2)), "m")
    await service.create(db_session, _new(system="АБС Core", category="RELEASE"), "m")  # открыт
    await service.create(db_session, _new(system="CRM ОПК", category="NETWORK",
                                          resolved_at=BASE + timedelta(hours=4)), "m")

    a = await service.analytics(db_session)
    assert a.total == 3
    assert a.open_count == 1 and a.resolved_count == 2
    assert a.avg_mttr_hours == 3.0                       # (2 + 4) / 2
    assert a.release_induced_share == round(2 / 3 * 100, 1)  # 66.7%
    cats = {c.category: c for c in a.by_category}
    assert cats["RELEASE"].count == 2 and cats["RELEASE"].open_count == 1
    assert cats["RELEASE"].avg_mttr_hours == 2.0         # только закрытый RELEASE
    # Топ нестабильных: АБС Core (2) впереди CRM ОПК (1).
    assert a.top_systems[0].system_name == "АБС Core" and a.top_systems[0].count == 2


async def test_triggering_characteristics(db_session):
    # T-16: категории сбоев маппятся на характеристики ISO для риск-триггеров.
    await service.create(db_session, _new(category='INFRASTRUCTURE'), 'm')
    await service.create(db_session, _new(category='NETWORK'), 'm')
    await service.create(db_session, _new(category='RELEASE'), 'm')
    tc = await service.triggering_characteristics(db_session)
    # INFRASTRUCTURE + NETWORK → «Надёжность»; RELEASE → «Сопровождаемость».
    assert 'Надёжность' in tc and 'Сопровождаемость' in tc
    nadezh = {lbl for lbl, _ in tc['Надёжность']}
    assert 'инфраструктура' in nadezh and 'сеть' in nadezh
    rel = {lbl for lbl, _ in tc['Сопровождаемость']}
    assert 'релиз' in rel


async def test_get_or_404(db_session):
    import uuid
    with pytest.raises(NotFoundError):
        await service.get_or_404(db_session, uuid.uuid4())


async def test_import_incidents_normalizes_and_dedups(db_session):
    # T-43: импорт нестандартизированных строк — нормализация первопричины/критичности/дат,
    # дедуп по (система+описание+дата), нераспознанная первопричина → OTHER + исходный текст.
    rows = [
        IncidentImportRow(system_name="CRM ОПК", title="Сбой A", occurred_at="10.02.2026 09:00",
                          category="Привнесено релизом", severity="P2", resolved_at="10.02.2026 15:00"),
        IncidentImportRow(system_name="CRM ОПК", title="Сбой A", occurred_at="10.02.2026 09:00", category="release"),  # дубль
        IncidentImportRow(system_name="", title="нет системы", occurred_at="2026-01-01"),                              # пропуск
        IncidentImportRow(system_name="HR", title="Странная причина", occurred_at="2026-03-01",
                          category="человеческий фактор"),                                                            # OTHER+custom
    ]
    res = await service.import_incidents(db_session, rows, "importer")
    assert res.created == 2 and res.skipped == 2 and len(res.errors) == 2

    items = await service.list_incidents(db_session)
    crm = next(i for i in items if i.title == "Сбой A")
    assert crm.category == "RELEASE" and crm.severity == "high" and crm.source == "import"
    assert crm.resolved_at is not None
    other = next(i for i in items if i.title == "Странная причина")
    assert other.category == "OTHER" and other.category_custom == "человеческий фактор"

    # Повторный импорт того же — всё уходит в дубли (0 создано).
    res2 = await service.import_incidents(db_session, rows[:1], "importer")
    assert res2.created == 0 and res2.skipped == 1


def test_ttr_stats_average_only_over_filled_values():
    """Тайминги TTR усредняются по заполненным значениям (ДЕФ-31, БТ-272).

    Пустые поля НЕ приравниваются к нулю: иначе среднее занижалось бы тем сильнее, чем
    хуже заполнены данные, и виджет показывал бы неоправданно хорошую картину.
    """
    from datetime import datetime, timedelta, timezone

    from app.modules.incidents.models import TechIncident
    from app.modules.incidents.service import _ttr_stats

    base = datetime(2026, 8, 1, tzinfo=timezone.utc)
    rows = [
        TechIncident(system_name="А", category="RELEASE", occurred_at=base,
                     resolved_at=base + timedelta(hours=2),
                     t_reaction_min=10, t_resolution_min=120, t_target_min=600,
                     root_cause_fixed_at=base + timedelta(hours=26)),
        TechIncident(system_name="Б", category="NETWORK", occurred_at=base,
                     resolved_at=base + timedelta(hours=1),
                     t_reaction_min=30, t_resolution_min=60),
        TechIncident(system_name="В", category="POWER", occurred_at=base),  # без таймингов
    ]
    stats = _ttr_stats(rows)
    assert stats.avg_reaction_min == 20.0          # (10+30)/2, третий не считается
    assert stats.avg_resolution_min == 90.0        # (120+60)/2
    assert stats.avg_target_min == 600.0           # единственное заполненное
    assert stats.measured_count == 2
    assert stats.root_cause_fixed_count == 1
    assert stats.avg_root_cause_lag_hours == 24.0  # первопричину чинили ещё сутки после подъёма


def test_ttr_stats_empty_returns_none_not_zero():
    from app.modules.incidents.service import _ttr_stats

    stats = _ttr_stats([])
    assert stats.avg_reaction_min is None and stats.avg_resolution_min is None
    assert stats.measured_count == 0
