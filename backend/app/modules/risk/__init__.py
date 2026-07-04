"""
Домен risk — сквозная (накопительная) база рисков; источник обоснований (grounding) для LLM.

Публичный фасад (ТЗ v13): доменные типы и прикладные функции. Веб-роутер СЮДА не тянем —
он монтируется композиционным корнем из app.modules.risk.router, чтобы реестр моделей и
соседние домены могли импортировать фасад без web-зависимостей и без циклов импорта.
"""
from app.modules.risk.models import RiskBase
from app.modules.risk.schemas import RiskBaseCreate, RiskBaseOut, RiskBaseUpdate
from app.modules.risk.service import risks_for_characteristics, search_risks

__all__ = [
    "RiskBase",
    "RiskBaseCreate",
    "RiskBaseUpdate",
    "RiskBaseOut",
    "search_risks",
    "risks_for_characteristics",
]
