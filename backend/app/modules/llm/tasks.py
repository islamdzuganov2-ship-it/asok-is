"""
Celery-задачи домена llm (ТЗ v13): фоновая генерация управленческого AI-резюме
и периодическая самооценка подсистемы по ISO/IEC 25010 (ТЗ v18 п.10).
"""
import logging

from app.infrastructure.workers import celery_app

logger = logging.getLogger(__name__)


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


@celery_app.task(name="tasks.llm_selfcheck")
def llm_selfcheck_task(mode: str = "full", trigger: str = "schedule") -> dict:
    """Самооценка LLM-подсистемы по ISO/IEC 25010 (ТЗ v18 п.10).

    Выполняется в воркере, а не в HTTP-запросе: на CPU с крупной моделью полный прогон
    занимает минуты. Отчёт сохраняется в «резервный мозг» (models/llm_brain/selfcheck/),
    откуда его читает дашборд суперадминистратора. Возвращается сводка, а не отчёт целиком —
    результаты Celery живут в Redis с ограниченным TTL, и класть туда мегабайты незачем.
    """
    from app.modules.llm import selfcheck

    report = selfcheck.run(mode=mode, trigger=trigger)
    logger.info("Самооценка LLM завершена: интеграл=%s, покрытие=%s, режим=%s, %.1f c",
                report.get("integral"), report.get("coverage"),
                report.get("mode"), report.get("duration_s", 0.0))
    return {
        "status": "COMPLETED",
        "id": report.get("id"),
        "generated_at": report.get("generated_at"),
        "integral": report.get("integral"),
        "coverage": report.get("coverage"),
        "duration_s": report.get("duration_s"),
        "mode": report.get("mode"),
    }
