"""
Главный файл приложения FastAPI АСОК ИС.
"""
import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.v1.api import api_router
from app.infrastructure.config import settings
from app.infrastructure.database import Base, engine, import_models
from app.scripts.seed_iso25010 import seed_iso25010_async
from app.shared.exceptions import (
    ConflictError,
    DomainError,
    NotFoundError,
    PermissionDeniedError,
    ValidationError,
)

import_models()  # реестр моделей: полная Base.metadata для стартового create_all (ТЗ v13)

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
    if not settings.DEMO_MODE:
        return
    # Создаём таблицы и сеем каталог метрик ИЗ КОДА (constants/quality_model.py),
    # без зависимости от Excel-файлов проекта.
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        await seed_iso25010_async()
    except Exception as exc:
        logger.warning("Стартовый сид пропущен: %s", exc)
