"""
Домен llm — встроенная (in-process) LLM: инференс, grounding-контроль, промпты,
экспорт обучающего корпуса (dataset), фоновые задачи. Здесь же конвейер
многоаспектного аналитического рассуждения (reasoning.py, ISO 25010/38500 — BL-005).

Публичный фасад (ТЗ v13). Подмодули dataset/tasks намеренно НЕ импортируются на фасаде
(тянут БД/celery); их импортируют скрипт экспорта и реестр задач соответственно.
"""
from app.modules.llm import brain, gate, reasoning, service
from app.modules.llm.gate import GateResult, evaluate_gate
from app.modules.llm.prompts import CONCLUSION_SYSTEM_PROMPT, SYSTEM_PROMPT
from app.modules.llm.reasoning import ReasoningInput, ReasoningTrace, generate_reasoned_conclusion, run_reasoning
from app.modules.llm.service import (
    complete,
    generate_judgment_conclusion,
    generate_measures_analytics,
    generate_summary,
    is_available,
    list_models,
    model_info,
    reload,
)

__all__ = [
    "service",
    "reasoning",
    "brain",
    "gate",
    "SYSTEM_PROMPT",
    "CONCLUSION_SYSTEM_PROMPT",
    "complete",
    "is_available",
    "model_info",
    "list_models",
    "reload",
    "generate_summary",
    "generate_judgment_conclusion",
    "generate_measures_analytics",
    "ReasoningInput",
    "ReasoningTrace",
    "run_reasoning",
    "generate_reasoned_conclusion",
    "GateResult",
    "evaluate_gate",
]
