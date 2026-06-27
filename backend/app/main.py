"""
Главный файл приложения FastAPI АСОК ИС.
"""
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pathlib import Path

from app.core.config import settings
from app.api.v1.api import api_router
from app.core.database import AsyncSessionLocal, engine
from app.db.base import Base
from app.services.excel_importer import seed_project_excel_files

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


@app.get("/")
async def root():
    return {"message": f"{settings.PROJECT_NAME} API работает"}


@app.get("/health")
async def health_check():
    return {"status": "ok", "service": settings.PROJECT_NAME}


@app.on_event("startup")
async def startup_seed_excel_data() -> None:
    if not settings.DEMO_MODE:
        return
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        async with AsyncSessionLocal() as db:
            project_root = Path(__file__).resolve().parents[2]
            await seed_project_excel_files(db, project_root)
    except Exception as exc:
        print(f"Excel seed skipped: {exc}")
