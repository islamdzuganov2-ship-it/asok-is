from fastapi import APIRouter
from app.api.v1.endpoints import assessments, metrics, auth

api_router = APIRouter()

api_router.include_router(auth.router,        prefix="/auth",        tags=["auth"])
api_router.include_router(assessments.router, prefix="/assessments", tags=["assessments"])
api_router.include_router(metrics.router,     prefix="/metrics",     tags=["metrics"])