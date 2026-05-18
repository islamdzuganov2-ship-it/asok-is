# backend/app/main.py
from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError, HTTPException
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
from sqlalchemy.exc import SQLAlchemyError
import logging
import sys

# === ИМПОРТЫ РОУТЕРОВ ===
# Импортируем после настройки логгера, чтобы избежать циклических зависимостей
from app.core.database import Base
from app.core.database import engine

from app.api.v1.endpoints import assessments, systems, auth

from app.models import system  # noqa: F401
from app.models import metric_catalog  # noqa: F401
from app.models import assessment  # noqa: F401
from app.models import user  # noqa: F401, если есть
from app.models import audit  # noqa: F401, если есть

# === НАСТРОЙКА ЛОГГИРОВАНИЯ ===
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger(__name__)

# === LIFESPAN КОНТЕКСТ ===
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Инициализация и завершение приложения"""
    # === STARTUP ===
    logger.info("🚀 Starting ASOK IS Backend v2.0.0...")
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        logger.info("✅ Database tables created successfully")
    except Exception as e:
        logger.error(f"❌ Failed to create database tables: {e}")
        raise
    
    logger.info("✅ Backend is ready to accept connections")
    yield
    
    # === SHUTDOWN ===
    logger.info("🛑 Shutting down application...")
    await engine.dispose()
    logger.info("✅ Application shutdown complete")

# === FASTAPI APP ===
app = FastAPI(
    title="АСОК ИС",
    description="Автоматизированная Система Оценки Качества Информационных Систем",
    version="2.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json"
)

# === CORS MIDDLEWARE ===
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# === EXCEPTION HANDLERS ===
@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    errors = []
    for error in exc.errors():
        loc = error.get("loc", [])
        field = ".".join(str(l) for l in loc if l not in ("body", "query", "path")) or "unknown"
        errors.append({
            "field": field,
            "message": error.get("msg", "Validation error"),
            "type": error.get("type", "validation_error")
        })
    logger.warning(f"Validation error on {request.url.path}: {errors}")
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"error": "Ошибка валидации входных данных", "details": errors}
    )

@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    logger.warning(f"HTTP {exc.status_code} on {request.url.path}: {exc.detail}")
    return JSONResponse(status_code=exc.status_code, content={"error": exc.detail})

@app.exception_handler(SQLAlchemyError)
async def database_exception_handler(request: Request, exc: SQLAlchemyError):
    logger.error(f"Database error on {request.url.path}: {exc}", exc_info=True)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"error": "Ошибка базы данных. Попробуйте позже."}
    )

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unexpected error on {request.url.path}: {exc}", exc_info=True)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"error": "Внутренняя ошибка сервера"}
    )

# === INCLUDE ROUTERS (после инициализации app) ===
def setup_routers():
    """Отложенная настройка роутеров для избежания циклических импортов"""
    from app.api.v1.endpoints import assessments, systems, auth
    app.include_router(auth.router, prefix="/auth", tags=["auth"])
    app.include_router(systems.router, prefix="/systems", tags=["systems"])
    app.include_router(assessments.router, prefix="/assessments", tags=["assessments"])

# Вызываем после создания app
setup_routers()

# === HEALTH CHECK ===
@app.get("/health", tags=["health"])
async def health_check():
    return {
        "status": "ok",
        "service": "АСОК ИС Backend",
        "version": "2.0.0",
        "environment": "development"
    }

# === ROOT ===
@app.get("/", tags=["root"])
async def root():
    return {
        "message": "🏦 АСОК ИС — Система оценки качества ИС",
        "version": "2.0.0",
        "documentation": {
            "swagger": "/docs",
            "redoc": "/redoc",
            "openapi": "/openapi.json"
        },
        "health": "/health"
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True, log_level="info")