"""Каталог типов событий уведомлений (ТЗ v19 п.6, УК-06) — событийная модель.

Домены эмитят события ИЗ ЭТОГО словаря через shared.ports.NotificationPort, а не строки на
месте — тот же принцип, что у статусов Proposal (governance/models.py STATUS_*): единый
источник истины, опечатка в коде становится ошибкой импорта, а не тихо потерянным событием.

Состав отражает уже существующую фронтовую таксономию колокольчика (notificationRules.ts:
escalation-decided/escalation-pending/overdue/soon/assigned) — тот же смысл событий, здесь же
добавлены APPROVED/REJECTED/EXECUTOR_BRIEF_READY, которых во фронтовом наборе не было (бэкенд
видит переходы состояния меры напрямую, фронт — только вычисляет их из текущего снимка).
"""
from __future__ import annotations

EVENT_MEASURE_APPROVED = "measure.approved"
EVENT_MEASURE_REJECTED = "measure.rejected"
EVENT_MEASURE_ESCALATED = "measure.escalated"
EVENT_MEASURE_ESCALATION_DECIDED = "measure.escalation_decided"
EVENT_MEASURE_EXECUTOR_BRIEF_READY = "measure.executor_brief_ready"
# ТЗ v19 §17.9 (УК-59/60): автоэскалация несоответствия по SLA (дифференцирован по критичности).
EVENT_NONCONFORMITY_SLA_ESCALATED = "nonconformity.sla_escalated"

# Заголовок по умолчанию для события — адаптер/вызывающий код может переопределить под контекст
# конкретной меры, это только нейтральная подпись типа события (для лога заглушки и на будущее).
EVENT_TITLES: dict[str, str] = {
    EVENT_MEASURE_APPROVED: "Мера одобрена",
    EVENT_MEASURE_REJECTED: "Мера отклонена",
    EVENT_MEASURE_ESCALATED: "Мера эскалирована топ-менеджменту",
    EVENT_MEASURE_ESCALATION_DECIDED: "Решение по эскалации принято",
    EVENT_MEASURE_EXECUTOR_BRIEF_READY: "Мера переписана для исполнителя",
    EVENT_NONCONFORMITY_SLA_ESCALATED: "Несоответствие эскалировано автоматически по SLA",
}

ALL_EVENTS: frozenset[str] = frozenset(EVENT_TITLES)
