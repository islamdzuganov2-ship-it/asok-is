"""Тесты сервисного слоя домена econ (BL-007, RE-01…RE-04).

Как в test_governance — проверяется БИЗНЕС-логика справочников на db_session (RBAC/require_role —
тонкий слой FastAPI поверх, покрывается E2E). Инварианты: идемпотентный сид финпараметров,
уникальность кодов/связей, upsert одной карточки стоимости на БП, разрешение ставки
(специфичная для ИС → иначе глобальная).
"""
import uuid

import pytest

from app.modules.econ import service
from app.modules.econ.models import ENTERPRISE_PROFILE_ID
from app.modules.econ.schemas import (
    BpCostIn,
    BusinessProcessCreate,
    BusinessProcessUpdate,
    EnterpriseProfileIn,
    SupportRateIn,
    SystemBpCreate,
)
from app.modules.iam.models import User
from app.modules.systems.models import CriticalityClass, System
from app.shared.exceptions import ConflictError, NotFoundError, ValidationError


async def _make_system(db, name="ИС-econ-test") -> System:
    sys = System(name=name, criticality_class=CriticalityClass.BUSINESS_OPERATIONAL)
    db.add(sys)
    await db.commit()
    await db.refresh(sys)
    return sys


async def _make_user(db, username="econ-test-user") -> User:
    """FK на users.id (ТЗ v19 УК-12) — updated_by/owner_user_id требуют реальной строки,
    случайный uuid4() ловит настоящее нарушение целостности, не тестовую заглушку."""
    user = User(username=username, password_hash="x", role=User.ROLE_ADMIN)
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


# ── Финпараметры ──

async def test_seed_econ_defaults_is_idempotent(db_session):
    n1 = await service.seed_econ_defaults(db_session)
    assert n1 > 0
    cfg = {c.key for c in await service.get_config(db_session)}
    assert "discount_rate_annual" in cfg and "rosi_horizon_months" in cfg
    # Повторный сид не добавляет и не затирает.
    assert await service.seed_econ_defaults(db_session) == 0


async def test_set_and_read_config_value(db_session):
    await service.seed_econ_defaults(db_session)
    await service.set_config(db_session, "discount_rate_annual", 0.15, "уточнено заказчиком")
    assert await service.config_value(db_session, "discount_rate_annual") == 0.15
    # Неизвестный ключ → default.
    assert await service.config_value(db_session, "no_such_key", default=42) == 42


# ── Бизнес-процессы ──

async def test_create_business_process_and_reject_duplicate(db_session):
    bp = await service.create_business_process(
        db_session, BusinessProcessCreate(code="BP-1", name="Приём платежей", kind="FRONTAL"),
    )
    assert bp.code == "BP-1" and bp.kind == "FRONTAL" and bp.is_active is True
    with pytest.raises(ConflictError):
        await service.create_business_process(db_session, BusinessProcessCreate(code="BP-1", name="Дубль"))


async def test_create_business_process_rejects_bad_kind(db_session):
    with pytest.raises(ValidationError):
        await service.create_business_process(
            db_session, BusinessProcessCreate(code="BP-X", name="Плохой", kind="WRONG"),
        )


async def test_update_business_process(db_session):
    bp = await service.create_business_process(db_session, BusinessProcessCreate(code="BP-2", name="Отчётность"))
    bp = await service.update_business_process(db_session, bp, BusinessProcessUpdate(is_active=False, owner="Иванов"))
    assert bp.is_active is False and bp.owner == "Иванов"


# ── Связь ИС↔БП ──

async def test_link_system_bp_and_reject_duplicate(db_session):
    sys = await _make_system(db_session)
    bp = await service.create_business_process(db_session, BusinessProcessCreate(code="BP-3", name="Кадры"))
    link = await service.link_system_bp(db_session, sys.id, SystemBpCreate(business_process_id=bp.id, share=0.5))
    assert float(link.share) == 0.5
    with pytest.raises(ConflictError):
        await service.link_system_bp(db_session, sys.id, SystemBpCreate(business_process_id=bp.id))


async def test_link_system_bp_unknown_bp_404(db_session):
    sys = await _make_system(db_session, name="ИС-2")
    with pytest.raises(NotFoundError):
        await service.link_system_bp(db_session, sys.id, SystemBpCreate(business_process_id=uuid.uuid4()))


# ── Стоимость минуты простоя (upsert одной карточки на БП) ──

async def test_bp_cost_upsert_keeps_single_card(db_session):
    bp = await service.create_business_process(db_session, BusinessProcessCreate(code="BP-4", name="Склад"))
    c1 = await service.upsert_bp_cost(db_session, bp.id, BpCostIn(method="RESOURCE", cost_per_min_base=100))
    c2 = await service.upsert_bp_cost(db_session, bp.id, BpCostIn(method="EXPERT", cost_per_min_base=250))
    assert c1.id == c2.id  # обновление той же карточки, не вторая строка
    assert c2.method == "EXPERT" and float(c2.cost_per_min_base) == 250


async def test_bp_cost_rejects_bad_method(db_session):
    bp = await service.create_business_process(db_session, BusinessProcessCreate(code="BP-5", name="Логистика"))
    with pytest.raises(ValidationError):
        await service.upsert_bp_cost(db_session, bp.id, BpCostIn(method="BOGUS"))


# ── Ставки сопровождения и их разрешение ──

async def test_resolve_support_rate_prefers_specific_then_global(db_session):
    sys = await _make_system(db_session, name="ИС-rates")
    # Глобальная ставка L2 (system_id = None) и специфичная для ИС.
    await service.create_rate(db_session, SupportRateIn(line="L2", rate_per_hour=2000))
    await service.create_rate(db_session, SupportRateIn(line="L2", system_id=sys.id, rate_per_hour=3500,
                                                        executor_type="VENDOR", vendor="Acme"))
    specific = await service.resolve_support_rate(db_session, line="L2", system_id=sys.id)
    assert specific is not None and float(specific.rate_per_hour) == 3500 and specific.vendor == "Acme"
    # Для другой ИС специфичной нет → падаем на глобальную.
    other = await _make_system(db_session, name="ИС-rates-2")
    fallback = await service.resolve_support_rate(db_session, line="L2", system_id=other.id)
    assert fallback is not None and float(fallback.rate_per_hour) == 2000 and fallback.system_id is None


async def test_create_rate_rejects_bad_line(db_session):
    with pytest.raises(ValidationError):
        await service.create_rate(db_session, SupportRateIn(line="L9", rate_per_hour=100))


# ── Профиль предприятия (ТЗ v19 УК-21, Р-4: одна запись, не справочник организаций) ──

async def test_enterprise_profile_get_or_create_returns_singleton(db_session):
    p1 = await service.get_enterprise_profile(db_session)
    assert p1.id == ENTERPRISE_PROFILE_ID
    # Повторный вызов не создаёт вторую строку — тот же id, поля по-прежнему пустые.
    p2 = await service.get_enterprise_profile(db_session)
    assert p2.id == p1.id


async def test_update_enterprise_profile_writes_fields_and_updated_by(db_session):
    user = await _make_user(db_session)
    updated = await service.update_enterprise_profile(
        db_session,
        EnterpriseProfileIn(name="АСОК Заказчик", size_class="MEDIUM", headcount=250,
                            industry="Финансы", region="РФ"),
        updated_by=user.id,
    )
    assert updated.id == ENTERPRISE_PROFILE_ID
    assert updated.name == "АСОК Заказчик"
    assert updated.size_class == "MEDIUM"
    assert updated.headcount == 250
    assert updated.updated_by == user.id

    # Повторное чтение — та же единственная строка с сохранёнными полями.
    again = await service.get_enterprise_profile(db_session)
    assert again.name == "АСОК Заказчик" and again.headcount == 250


async def test_update_enterprise_profile_rejects_unknown_size_class(db_session):
    with pytest.raises(ValidationError):
        await service.update_enterprise_profile(
            db_session, EnterpriseProfileIn(size_class="GIGANTIC"), updated_by=None,
        )


async def test_update_enterprise_profile_partial_update_keeps_other_fields(db_session):
    await service.update_enterprise_profile(
        db_session, EnterpriseProfileIn(name="Исходное имя", headcount=100), updated_by=None,
    )
    updated = await service.update_enterprise_profile(
        db_session, EnterpriseProfileIn(headcount=150), updated_by=None,
    )
    # exclude_unset=True: headcount обновился, name — нет (не передавался во втором вызове).
    assert updated.headcount == 150
    assert updated.name == "Исходное имя"
