from fastapi import APIRouter
from .endpoints import assessments, metrics, auth, systems
from . import reports

api_router = APIRouter()

api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(systems.router, prefix="/systems", tags=["systems"])
api_router.include_router(assessments.router, prefix="/assessments", tags=["assessments"])
api_router.include_router(metrics.router, prefix="/metrics", tags=["metrics"])
api_router.include_router(reports.router, prefix="/reports", tags=["reports"])