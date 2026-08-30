"""
Домен nonconformity (BL-007, RE-14) — несоответствие подхарактеристики (E3) и замыкание контура.

Хребет перехода АСОК из «системы оценки» в «систему принятия решений»: жизненный цикл несоответствия
от «Выявлено» до «Верифицировано» с обязательным владельцем и независимой верификацией (§3.3).
Публичный фасад: модель — в реестре import_models(); роутер монтируется в api/v1/api.py (по готовности).
"""
from app.modules.nonconformity.models import (
    EVIDENCE_TYPES,
    LEVEL_CRITICAL,
    LEVELS,
    STATUS_EVALUATED,
    STATUS_FLOW,
    Nonconformity,
)

__all__ = [
    "Nonconformity", "STATUS_FLOW", "LEVELS", "EVIDENCE_TYPES",
    "STATUS_EVALUATED", "LEVEL_CRITICAL",
]
