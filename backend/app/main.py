"""
Главный файл приложения FastAPI АСОК ИС.
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pathlib import Path

from app.core.config import settings
from app.api.v1.api import api_router
from app.core.database import AsyncSessionLocal, engine
from app.db.base import Base
from app.services.excel_importer import seed_project_excel_files

app = FastAPI(
    title=settings.PROJECT_NAME,
    docs_url="/docs",
    redoc_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
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
