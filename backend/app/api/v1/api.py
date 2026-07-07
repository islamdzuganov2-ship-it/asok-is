from fastapi import APIRouter

from app.modules.assessment.ai_router import router as ai_assessments_router  # контур СИИ ГОСТ 59898 (BL-001)
from app.modules.assessment.router import router as assessments_router  # домен assessment мигрирован (ТЗ v13)
from app.modules.dataio.router import router as excel_router  # домен dataio мигрирован (ТЗ v13)
from app.modules.governance.router import router as governance_router  # governance-петля в БД (T-10)
from app.modules.iam.router import router as auth_router  # домен iam мигрирован (ТЗ v13)
from app.modules.quality.router import router as metrics_router  # домен quality мигрирован (ТЗ v13)
from app.modules.reporting.router import router as reporting_router  # домен reporting мигрирован (ТЗ v13)
from app.modules.risk.router import router as risk_router  # домен risk мигрирован (ТЗ v13)
from app.modules.systems.router import router as systems_router  # домен systems мигрирован (ТЗ v13)

api_router = APIRouter()

api_router.include_router(auth_router, prefix="/auth", tags=["auth"])
api_router.include_router(systems_router, prefix="/systems", tags=["systems"])
api_router.include_router(assessments_router, prefix="/assessments", tags=["assessments"])
api_router.include_router(ai_assessments_router, prefix="/ai-assessments", tags=["ai-assessments"])
api_router.include_router(metrics_router, prefix="/metrics", tags=["metrics"])
api_router.include_router(reporting_router, prefix="/reports", tags=["reports"])
api_router.include_router(excel_router, prefix="/excel", tags=["excel"])
api_router.include_router(risk_router, prefix="/risks", tags=["risks"])
api_router.include_router(governance_router, prefix="/governance", tags=["governance"])
