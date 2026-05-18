from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError, HTTPException
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
from sqlalchemy.exc import SQLAlchemyError
import logging
import sys

# ИМПОРТЫ БД
from app.core.database import Base, engine

# ИМПОРТЫ МОДЕЛЕЙ (необходимы для метаданных Alembic/SQLAlchemy)
from app.models import system
from app.models import metric_catalog
from app.models import assessment
from app.models import user
from app.models import audit

# ИМПОРТЫ РОУТЕРОВ
from app.api.v1.endpoints import assessments, systems, auth

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(app: FastAPI):
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
    
    logger.info("🛑 Shutting down application...")
    await engine.dispose()
    logger.info("✅ Application shutdown complete")

app = FastAPI(
    title="АСОК ИС",
    description="Автоматизированная Система Оценки Качества Информационных Систем",
    version="2.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api/v1/auth", tags=["auth"])
app.include_router(systems.router, prefix="/api/v1/systems", tags=["systems"])
app.include_router(assessments.router, prefix="/api/v1/assessments", tags=["assessments"])

@app.get("/health", tags=["health"])
async def health_check():
    return {"status": "ok", "service": "АСОК ИС Backend"}

@app.get("/", tags=["root"])
async def root():
    return {"message": "🏦 АСОК ИС — Система оценки качества ИС"}