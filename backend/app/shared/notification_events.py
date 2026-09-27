"""Каталог типов событий уведомлений (ТЗ v19 п.6, УК-15) — событийная модель.

Домены эмитят события ИЗ ЭТОГО словаря через журнал уведомлений (modules/notifications), а не
строки на месте — тот же принцип, что у статусов Proposal (governance/models.py STATUS_*): единый
источник истины, опечатка в коде становится ошибкой импорта, а не тихо потерянным событием.

Состав отражает уже существующую фронтовую таксономию колокольчика (notificationRules.ts:
escalation-decided/escalation-pending/overdue/soon/assigned) — тот же смысл событий, здесь же
добавлены APPROVED/REJECTED/EXECUTOR_BRIEF_READY, которых во фронтовом наборе не было (бэкенд
видит переходы состояния меры напрямую, фронт — только вычисляет их из текущего снимка).

УК-15 перечисляет пять событий модели: «измерение просрочено», «мера назначена», «срок меры
истекает через N дней», «риск превысил порог», «оценка ждёт согласования» — они ниже вместе с
шаблонами (EVENT_TEMPLATES): текст письма собирается из данных карточки, а не пишется на месте.
"""
from __future__ import annotations

EVENT_MEASURE_APPROVED = "measure.approved"
EVENT_MEASURE_REJECTED = "measure.rejected"
EVENT_MEASURE_ESCALATED = "measure.escalated"
EVENT_MEASURE_ESCALATION_DECIDED = "measure.escalation_decided"
EVENT_MEASURE_EXECUTOR_BRIEF_READY = "measure.executor_brief_ready"
# ТЗ v19 §17.9 (УК-59, УК-60): автоэскалация несоответствия/меры по SLA.
EVENT_NONCONFORMITY_SLA_ESCALATED = "nonconformity.sla_escalated"
EVENT_MEASURE_SLA_ESCALATED = "measure.sla_escalated"
# УК-15: пять событий событийной модели.
EVENT_MEASUREMENT_OVERDUE = "measurement.overdue"
EVENT_MEASURE_ASSIGNED = "measure.assigned"
EVENT_MEASURE_DUE_SOON = "measure.due_soon"
EVENT_RISK_THRESHOLD_EXCEEDED = "risk.threshold_exceeded"
EVENT_ASSESSMENT_AWAITING_APPROVAL = "assessment.awaiting_approval"
# УК-17: срок меры как календарное приглашение (вложение .ics через тот же порт).
EVENT_MEASURE_CALENDAR = "measure.calendar"

# Адресат-роль: эскалация адресована топ-менеджменту как роли (SoD v12 §5.1), а не человеку.
# Журнал разворачивает её в адреса пользователей с правом governance.decide.
RECIPIENT_TOP_MANAGEMENT = "топ-менеджмент"

# Заголовок по умолчанию для события — адаптер/вызывающий код может переопределить под контекст
# конкретной меры, это только нейтральная подпись типа события (для лога заглушки и журнала).
EVENT_TITLES: dict[str, str] = {
    EVENT_MEASURE_APPROVED: "Мера одобрена",
    EVENT_MEASURE_REJECTED: "Мера отклонена",
    EVENT_MEASURE_ESCALATED: "Мера эскалирована топ-менеджменту",
    EVENT_MEASURE_ESCALATION_DECIDED: "Решение по эскалации принято",
    EVENT_MEASURE_EXECUTOR_BRIEF_READY: "Мера переписана для исполнителя",
    EVENT_NONCONFORMITY_SLA_ESCALATED: "Несоответствие эскалировано автоматически по SLA",
    EVENT_MEASURE_SLA_ESCALATED: "Мера эскалирована автоматически по SLA",
    EVENT_MEASUREMENT_OVERDUE: "Измерение просрочено",
    EVENT_MEASURE_ASSIGNED: "Мера назначена",
    EVENT_MEASURE_DUE_SOON: "Срок меры истекает",
    EVENT_RISK_THRESHOLD_EXCEEDED: "Риск превысил порог",
    EVENT_ASSESSMENT_AWAITING_APPROVAL: "Оценка ждёт согласования",
    EVENT_MEASURE_CALENDAR: "Срок меры в календаре",
}

# Шаблоны (УК-15): {поле} подставляется из контекста карточки. Отсутствующее поле — ошибка
# рендера (KeyError), а не пустое место в письме: шаблон и эмиттер обязаны договориться о полях.
EVENT_TEMPLATES: dict[str, tuple[str, str]] = {
    EVENT_MEASUREMENT_OVERDUE: (
        "Измерение просрочено: {system}",
        "Последняя оценка ИС «{system}» — {last_period}. Ожидалась оценка за {expected_period}. "
        "Внесите значения метрик или отметьте причину задержки.",
    ),
    EVENT_MEASURE_ASSIGNED: (
        "Вам назначена мера: {title}",
        "ИС «{system}». Срок: {due}. Трудоёмкость: {effort}. {brief}",
    ),
    EVENT_MEASURE_DUE_SOON: (
        "Срок меры истекает через {days} дн.: {title}",
        "ИС «{system}». Срок: {due}. Отметьте исполнение или запросите перенос срока.",
    ),
    EVENT_RISK_THRESHOLD_EXCEEDED: (
        "Риск превысил порог: {title}",
        "ИС «{system}». Годовая стоимость риска {ale} превысила риск-аппетит {appetite}. "
        "Нужна мера или решение о принятии риска.",
    ),
    EVENT_ASSESSMENT_AWAITING_APPROVAL: (
        "Оценка ждёт согласования: {system} · {period}",
        "Аналитик завершил оценку ИС «{system}» за {period}. Проверьте и согласуйте результат.",
    ),
    EVENT_MEASURE_CALENDAR: (
        "Срок меры: {title} — {due}",
        "Приглашение с датой срока меры во вложении (формат iCalendar).",
    ),
    EVENT_MEASURE_SLA_ESCALATED: (
        "Мера эскалирована по SLA: {title}",
        "Мера по ИС «{system}» просрочена на {days_overdue} дн. при SLA {sla_days} дн. "
        "Карточка поднята к топ-менеджменту автоматически.",
    ),
}

ALL_EVENTS: frozenset[str] = frozenset(EVENT_TITLES)


def render(event_type: str, **ctx) -> tuple[str, str]:
    """Тема и текст события по шаблону. Для событий без шаблона — заголовок каталога и пустой
    текст (текст тогда собирает эмиттер сам, как у переходов состояния меры)."""
    if event_type not in EVENT_TITLES:
        raise KeyError(f"Неизвестный тип события: {event_type}")
    tpl = EVENT_TEMPLATES.get(event_type)
    if tpl is None:
        return EVENT_TITLES[event_type], ""
    return tpl[0].format(**ctx), tpl[1].format(**ctx)
