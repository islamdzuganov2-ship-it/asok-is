# backend/app/schemas/metric.py
from pydantic import BaseModel, ConfigDict

class MetricCatalogResponse(BaseModel):
    id: int
    characteristic: str
    subcharacteristic: str
    formula_type: str  # "DIRECT" или "INVERSE"
    description: str | None = None
    data_source: str | None = None
    
    model_config = ConfigDict(
        from_attributes=True,
        json_schema_extra={
            "example": {
                "id": 1,
                "characteristic": "Функциональная пригодность",
                "subcharacteristic": "Функциональное покрытие", 
                "formula_type": "INVERSE",
                "description": "X = 1 - A/B",
                "data_source": "ТЗ + Результаты тестирования"
            }
        }
    )