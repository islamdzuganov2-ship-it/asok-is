from fastapi import APIRouter, Depends
from app.schemas.assessment import DashboardDataOut
# from app.api.deps import get_db

router = APIRouter()

@router.get("/executive-dashboard", response_model=DashboardDataOut)
async def get_executive_dashboard():
    # TODO: Собрать агрегированные данные из БД (среднее по ландшафту)
    # TODO: Сделать запрос к LLM (или достать из кэша) для aiInsights
    # TODO: Сформировать HeatmapData
    
    # Возвращаем заглушку, чтобы фронтенд уже мог отрисовать графики
    return {
        "globalHealthScore": 68.5,
        "aiInsights": "Наблюдается общая деградация по покрытию автотестами в системах класса Mission Critical.",
        "heatmapData": [
            [0, 0, 5], [0, 1, 1], [0, 2, 0], [1, 0, 3], [1, 1, 4]
        ],
        "xAxisLabels": ["Надежность", "Производительность", "Безопасность"],
        "yAxisLabels": ["CRM ОПК", "АБС Core"],
        "problematicSystems": [
            {
                "id": "123e4567-e89b-12d3-a456-426614174000",
                "name": "АБС Core",
                "criticality": "MISSION CRITICAL",
                "lowMetricsCount": 8
            }
        ]
    }

GET /reports/{period_id}/xlsx — Excel через openpyxl, RAG-заливка ячеек уровня качества, агрегатная строка по уровням
- GET /reports/{period_id}/json — JSON с meta + metrics
- GET /reports/{period_id}/csv — CSV с UTF-8 BOM для MS Excel
- PDF отключён за Feature Flag FEATURE_PDF_REPORTS
- StreamingResponse для всех форматов (не буферизует в памяти сервера)
- RAG цвета: Высокий=FF52C41A, Выше ср.=FF73D13D, Средний=FFFAAD14, Ниже ср.=FFFA8C16, Низкий=FFF5222D, Нет=FFD9D9D9