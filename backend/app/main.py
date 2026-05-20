"""
Главный файл приложения FastAPI.
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.api.v1.endpoints import auth, assessments, metrics  # убрали systems, experts

app = FastAPI(
    title=settings.PROJECT_NAME,
    docs_url="/docs" if settings.DEMO_MODE else None,
    redoc_url=None
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api/v1/auth", tags=["auth"])
app.include_router(assessments.router, prefix="/api/v1/assessments", tags=["assessments"])
app.include_router(metrics.router, prefix="/api/v1/metrics", tags=["metrics"])

@app.get("/")
async def root():
    return {"message": f"{settings.PROJECT_NAME} API работает"}

@app.get("/health")
async def health_check():
    return {"status": "ok"}