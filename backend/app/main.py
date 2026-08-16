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

app = FastAPI(
    title=settings.PROJECT_NAME,
    docs_url="/docs",
    redoc_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    # Разрешаем рабочий домен и его поддомены (asokis.ai, asok.asokis.ai, …).
    # Основной сценарий — same-origin через прокси Vite, CORS тут как подстраховка.
    allow_origin_regex=r"https://([a-z0-9-]+\.)?asokis\.ai",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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
