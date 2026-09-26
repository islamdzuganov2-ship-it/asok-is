"""
Главный файл приложения FastAPI АСОК ИС.
"""
import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.v1.api import api_router
from app.infrastructure.config import settings
from app.infrastructure.database import AsyncSessionLocal, import_models
from app.infrastructure.logging_config import setup_logging
from app.infrastructure.request_context import RequestContextMiddleware
from app.infrastructure.security_headers import SecurityHeadersMiddleware
from app.modules.econ import seed_econ_defaults, seed_market_benchmarks
from app.modules.iam import seed_rbac_defaults
from app.modules.llm import service as llm_service
from app.scripts.seed_iso25010 import seed_iso25010_async
from app.shared.exceptions import (
    ConflictError,
    DomainError,
    NotFoundError,
    PermissionDeniedError,
    ValidationError,
)

# Реестр моделей: полная Base.metadata нужна alembic/env.py для autogenerate и
# тестовому conftest для create_all тестовой БД (ТЗ v13).
import_models()

# ИБ-09: единая конфигурация логов (уровень, JSON, request_id, маскирование ПДн/секретов) —
# до первых сообщений приложения, иначе ранние строки ушли бы в лог без маскирования.
setup_logging()
logger = logging.getLogger(__name__)

# Контроль безопасности конфигурации. В проде (DEMO_MODE=false) дефолтные секреты
# недопустимы — приложение не должно стартовать (ГОСТ Р 57580, 152-ФЗ).
_security_issues = settings.security_issues()
if _security_issues:
    if settings.DEMO_MODE:
        logger.warning("НЕБЕЗОПАСНАЯ КОНФИГУРАЦИЯ (допустимо только в DEMO_MODE): %s",
                       "; ".join(_security_issues))
    else:
        raise RuntimeError(
            "Запрещён старт в production с небезопасной конфигурацией: "
            + "; ".join(_security_issues)
        )

# ИБ-07 (SEC-12): при API_DOCS_ENABLED=false /docs, /redoc и /openapi.json не регистрируются
# вообще (не просто скрыты) — openapi_url=None убирает и саму JSON-схему, не только Swagger UI.
_docs_enabled = settings.API_DOCS_ENABLED
app = FastAPI(
    title=settings.PROJECT_NAME,
    docs_url="/docs" if _docs_enabled else None,
    redoc_url=None,
    openapi_url="/openapi.json" if _docs_enabled else None,
)

# ИБ-14: методы и заголовки — перечнем, а не «*».
CORS_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
CORS_HEADERS = ["Authorization", "Content-Type", "Accept", "X-Request-ID"]

app.add_middleware(
    CORSMiddleware,
    # ИБ-14 (SEC-13): только явный список origin из настроек. Прежний allow_origin_regex на ЛЮБОЙ
    # поддомен asokis.ai вместе с allow_credentials отдавал доступ с учётными данными любому
    # поддомену, в т.ч. заброшенному или перехваченному (subdomain takeover). Штатный сценарий —
    # same-origin через прокси (Vite в разработке, nginx в проде), CORS нужен только для
    # отдельно размещённого фронта: его origin перечисляется в CORS_ORIGINS явно.
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=CORS_METHODS,
    allow_headers=CORS_HEADERS,
    expose_headers=["X-Request-ID", "Retry-After"],
)

# ИБ-13: заголовки безопасности на каждом ответе; ИБ-08/09: request_id, IP и User-Agent в
# контексте запроса (журнал ИБ и строки лога). Порядок: последний добавленный — внешний, поэтому
# контекст запроса оборачивает всё остальное, включая CORS и заголовки.
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(RequestContextMiddleware)

app.include_router(api_router, prefix="/api/v1")

# Маппинг доменных исключений на HTTP (ТЗ v13: домены бросают доменные ошибки, транспорт — здесь).
_DOMAIN_HTTP_STATUS = [
    (NotFoundError, 404),
    (ConflictError, 409),
    (ValidationError, 422),
    (PermissionDeniedError, 403),
]


@app.exception_handler(DomainError)
async def _domain_error_handler(request: Request, exc: DomainError) -> JSONResponse:
    status_code = next((code for typ, code in _DOMAIN_HTTP_STATUS if isinstance(exc, typ)), 400)
    return JSONResponse(status_code=status_code, content={"detail": str(exc)})


@app.get("/")
async def root():
    return {"message": f"{settings.PROJECT_NAME} API работает"}


@app.get("/health")
async def health_check():
    return {"status": "ok", "service": settings.PROJECT_NAME}


@app.on_event("startup")
async def startup_init() -> None:
    """Первичный сид справочников и матрицы прав.

    Схему БД здесь БОЛЬШЕ НЕ СОЗДАЁМ: за неё отвечает `alembic upgrade head`, который
    выполняется до запуска uvicorn (см. команду backend в docker-compose.yml и
    app/scripts/migrate.py). Прежний `Base.metadata.create_all()` работал только под
    DEMO_MODE, из-за чего в продуктиве схема не создавалась вообще, а на демо-стенде
    не применялись ALTER из миграций — БТ-507, ДЕФ-03.

    Сид остаётся под DEMO_MODE: это демо-ДАННЫЕ, а не схема.
    """
    # ДЕФ-04: прогрев модели в фоне. Первый пользовательский запрос иначе платит за холодную
    # загрузку весов (замер: ~10 минут на 6962 МБ), причём под глобальной блокировкой — вставал
    # весь бэкенд. Прогрев не блокирует старт: пока идёт загрузка, LLM-эндпоинты отдают
    # детерминированный результат.
    llm_service.warmup()

    if not settings.DEMO_MODE:
        return
    # Сеем каталог метрик ИЗ КОДА (modules/quality/quality_model.py), без зависимости
    # от Excel-файлов проекта.
    try:
        await seed_iso25010_async()
        # BL-007: первичный сид финпараметров контура (идемпотентно — не затирает правки).
        async with AsyncSessionLocal() as econ_session:
            await seed_econ_defaults(econ_session)
        # ТЗ v19 п.9-10: сид рыночных бенчмарков source-данными (идемпотентно, В-30а закрыт).
        async with AsyncSessionLocal() as benchmark_session:
            await seed_market_benchmarks(benchmark_session)
        # BL-008: дефолтная матрица прав role→permission + учётка superadmin (идемпотентно).
        async with AsyncSessionLocal() as rbac_session:
            await seed_rbac_defaults(rbac_session)
    except Exception as exc:
        logger.warning("Стартовый сид пропущен: %s", exc)
