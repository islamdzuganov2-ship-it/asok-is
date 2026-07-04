"""
Celery-задачи домена llm (ТЗ v13): фоновая генерация управленческого AI-резюме.
"""
from app.infrastructure.workers import celery_app


@celery_app.task(name="tasks.generate_ai_summary")
def generate_ai_summary_task(period_id: str, system_name: str, period_label: str,
                             metrics_block: str = "", known_risks: str = "") -> dict:
    """Генерация AI-резюме встроенной (in-process) LLM. Без внешних сервисов."""
    from app.modules.llm import service as llm_service

    summary = llm_service.generate_summary(
        system_name=system_name,
        period_label=period_label,
        metrics_block=metrics_block,
        known_risks=known_risks,
    )
    return {"status": "COMPLETED", "summary": summary,
            "llm": llm_service.is_available()}
