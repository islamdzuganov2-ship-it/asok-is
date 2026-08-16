"""
Домен llm — встроенная (in-process) LLM: инференс, grounding-контроль, промпты,
экспорт обучающего корпуса (dataset), фоновые задачи. Здесь же конвейер
многоаспектного аналитического рассуждения (reasoning.py, ISO 25010/38500 — BL-005).

Слой ТЗ v18 (BL-009): ролевые персоны адресата (personas), управленческие принципы резюме
(principles), матрицы принятия решений (decisions), декларативная матрица конвейера RAG и
обучения (pipeline) и самооценка подсистемы по ISO/IEC 25010 (selfcheck).

Публичный фасад (ТЗ v13). Подмодули dataset/tasks намеренно НЕ импортируются на фасаде
(тянут БД/celery); их импортируют скрипт экспорта и реестр задач соответственно.
"""
from app.modules.llm import (
    brain,
    decisions,
    gate,
    personas,
    pipeline,
    principles,
    reasoning,
    selfcheck,
    service,
)
from app.modules.llm.gate import GateResult, evaluate_gate
from app.modules.llm.personas import PERSONAS, Persona
from app.modules.llm.prompts import CONCLUSION_SYSTEM_PROMPT, SYSTEM_PROMPT
from app.modules.llm.reasoning import ReasoningInput, ReasoningTrace, generate_reasoned_conclusion, run_reasoning
from app.modules.llm.service import (
    complete,
    generate_executor_brief,
    generate_judgment_conclusion,
    generate_management_summary,
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
    "personas",
    "principles",
    "decisions",
    "pipeline",
    "selfcheck",
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
    "generate_management_summary",
    "generate_executor_brief",
    "ReasoningInput",
    "ReasoningTrace",
    "run_reasoning",
    "generate_reasoned_conclusion",
    "GateResult",
    "evaluate_gate",
    "Persona",
    "PERSONAS",
]
