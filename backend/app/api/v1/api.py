from fastapi import APIRouter

from app.api.v1 import excel_upload, reports, risk_base
from app.api.v1.endpoints import assessments, auth, metrics, systems

api_router = APIRouter()

api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(systems.router, prefix="/systems", tags=["systems"])
api_router.include_router(assessments.router, prefix="/assessments", tags=["assessments"])
api_router.include_router(metrics.router, prefix="/metrics", tags=["metrics"])
api_router.include_router(reports.router, prefix="/reports", tags=["reports"])
api_router.include_router(excel_upload.router, prefix="/excel", tags=["excel"])
api_router.include_router(risk_base.router, prefix="/risks", tags=["risks"])
