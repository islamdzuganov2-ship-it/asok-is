"""Страж покрытия эндпоинтов правами (ДЕФ-42, вторая очередь).

Ревью 2026-09-07 нашло, что 68 из 171 эндпоинта закрыты только аутентификацией. Денежные
закрыты первой очередью (`test_money_rbac.py`), остальные доменные — этой.

Тест держит ДВА инварианта:

1. **Доменное чтение требует права.** Проверяется на роли EXECUTOR: у неё нет ни
   `view.risk_economics`, ни `view.risks`, ни `view.assessments`, ни `view.ai_assessments`,
   поэтому она — естественный «отрицательный» пробник.

2. **Список намеренно открытых эндпоинтов зафиксирован.** Открытым остаётся только то, без
   чего интерфейс не соберётся у любой роли (bootstrap прав и настроек, справочник ИС,
   методологический каталог ISO 25010, статус LLM). Если кто-то откроет ещё один эндпоинт —
   тест упадёт и потребует осознанного решения, а не молчаливого расширения поверхности.
"""
import httpx
import pytest
from httpx import ASGITransport

from app.infrastructure.database import get_db
from app.main import app
from app.modules.iam import permissions_service as ps
from app.modules.iam.security import create_access_token

API = "/api/v1"

#: Доменные чтения, закрытые второй очередью. EXECUTOR не имеет соответствующих прав.
CLOSED_FOR_EXECUTOR = [
    # База рисков — view.risks
    "/risks",
    "/risks/search?q=аб",
    # Рисковые события — view.risk_economics / view.dashboard.risk
    "/risk-events",
    "/risk-events/by-cell?system_name=X&characteristic=Y",
    # Оценки — view.assessments (суждения)
    "/assessments/judgments-status",
    "/assessments/judgments-pending",
    # Несоответствия — view.risk_economics / nonconformity.edit
    "/nonconformities",
    "/nonconformities/funnel",
    # Справочники контура — view.risk_economics
    "/econ/config",
    "/econ/business-processes",
    "/econ/measure-catalog",
]
#: Чтения, которые открывает любое из прав «аналитический дашборд / оценки / основное
#: менеджера». `view.dashboard.analytics` по умолчанию есть у ВСЕХ редактируемых ролей, включая
#: EXECUTOR (ДЕФ-10: «тот же состав дашбордов, что у топ-менеджера»), поэтому EXECUTOR для них
#: не отрицательный пробник — это легитимный доступ. Закрытость проверяется ролью без прав.
CLOSED_FOR_ROLE_WITHOUT_RIGHTS = [
    "/assessments/dashboard",
    "/assessments/periods",
]

# `/reports/system-dynamics` сюда не входит намеренно: у него обязательный `system_id`,
# и без него FastAPI ответит 422 раньше, чем сработает проверка права — тест проверял бы
# валидацию параметров, а не RBAC.

#: Намеренно открытые: без них интерфейс не собирается ни у одной роли.
#: Менять список — только вместе с обоснованием в ТЗ-23 §6.
INTENTIONALLY_OPEN = [
    "/iam/me/permissions",      # bootstrap: по нему строится всё меню и маршруты
    "/iam/me/preferences",      # свои настройки (раскладки дашбордов, порядок меню, тема)
    "/iam/mandatory-sections",  # AppLayout всех ролей
    "/systems",                 # справочник ИС: селекторы, SliceBar, командная строка
    "/metrics/",                # каталог ISO 25010 — методологическая константа (роутер quality)
    "/reports/llm-status",      # индикатор Демо/LLM в шапке у всех ролей
]


@pytest.fixture(autouse=True)
def _reset_perm_cache():
    ps.reset_cache()
    yield
    ps.reset_cache()


@pytest.fixture
async def aclient(db_session):
    async def _override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = _override_get_db
    transport = ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.pop(get_db, None)


def _auth(role: str) -> dict:
    token = create_access_token(
        {"sub": "00000000-0000-0000-0000-0000000000fe", "role": role, "username": f"t_{role.lower()}"}
    )
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.parametrize("path", CLOSED_FOR_EXECUTOR)
async def test_executor_denied_domain_reads(aclient, db_session, path):
    """Доменное чтение без права — 403, а не данные."""
    await ps.seed_rbac_defaults(db_session)
    r = await aclient.get(f"{API}{path}", headers=_auth("EXECUTOR"))
    assert r.status_code == 403, f"{path} отдал {r.status_code}: {r.text[:200]}"


@pytest.mark.parametrize("path", CLOSED_FOR_ROLE_WITHOUT_RIGHTS)
async def test_role_without_rights_denied_assessment_reads(aclient, db_session, path):
    """Роль, которой в матрице не выдано ни одного права, получает 403, а не данные оценки."""
    await ps.seed_rbac_defaults(db_session)
    r = await aclient.get(f"{API}{path}", headers=_auth("NO_RIGHTS_ROLE"))
    assert r.status_code == 403, f"{path} отдал {r.status_code}: {r.text[:200]}"


@pytest.mark.parametrize("path", CLOSED_FOR_EXECUTOR + CLOSED_FOR_ROLE_WITHOUT_RIGHTS)
async def test_entitled_role_still_reads(aclient, db_session, path):
    """Роль с правами читает то же самое — закрытие не сломало легитимный доступ.

    QUALITY_MANAGER держит и `view.assessments`, и `view.risks`, и `view.risk_economics`,
    и `view.reports`, поэтому покрывает весь список одним пробником.
    """
    await ps.seed_rbac_defaults(db_session)
    r = await aclient.get(f"{API}{path}", headers=_auth("QUALITY_MANAGER"))
    assert r.status_code == 200, f"{path} отдал {r.status_code}: {r.text[:200]}"


@pytest.mark.parametrize("path", INTENTIONALLY_OPEN)
async def test_bootstrap_endpoints_stay_open(aclient, db_session, path):
    """Bootstrap-поверхность доступна любой аутентифицированной роли — иначе UI не соберётся."""
    await ps.seed_rbac_defaults(db_session)
    r = await aclient.get(f"{API}{path}", headers=_auth("EXECUTOR"))
    assert r.status_code == 200, f"{path} отдал {r.status_code}: {r.text[:200]}"


async def test_open_surface_did_not_grow(db_session):
    """Число эндпоинтов без проверки права зафиксировано.

    Считаем по исходникам, а не по маршрутам FastAPI: зависимость `require_permission(...)`
    создаётся фабрикой, и отличить её от `get_current_user` в графе зависимостей надёжнее
    всего по объявлению. Рост числа = кто-то открыл ещё одну ручку; это должно быть
    осознанным решением с правкой ТЗ-23 §6, а не незамеченным следствием.
    """
    from pathlib import Path

    root = Path(__file__).resolve().parent.parent / "app"
    open_count = sum(
        f.read_text(encoding="utf-8").count("Depends(get_current_user)")
        for f in root.rglob("*.py")
        # deps.py — не эндпоинты: там `get_current_user` стоит внутри самих проверяющих
        # `require_role`/`require_permission`, то есть считался бы дважды и не по делу.
        if f.name != "deps.py"
    )
    # 16 = 15 по ревью 2026-09-07 + POST /auth/logout (ИБ-12): выход отзывает только
    # собственную сессию, право на него было бы бессмысленным.
    assert open_count == 16, (
        f"эндпоинтов без проверки права: {open_count}, ожидалось 16. "
        "Если открытие намеренное — обновите список и обоснование в ТЗ-23 §6."
    )
