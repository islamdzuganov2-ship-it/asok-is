from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime
import uuid

class AssessmentValueCreate(BaseModel):
    metric_id: int
    val_a: float
    val_b: float
    expert_comment: Optional[str] = None
    data_source: str = "MANUAL"

class AssessmentValueResponse(BaseModel):
    id: uuid.UUID
    metric_id: int
    characteristic: Optional[str] = None
    subcharacteristic: Optional[str] = None
    period: Optional[str] = None
    val_a: Optional[float] = None
    val_b: Optional[float] = None
    calculated_x: Optional[float] = None
    quality_level: Optional[str] = None
    expert_comment: Optional[str] = None
    data_source: Optional[str] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True