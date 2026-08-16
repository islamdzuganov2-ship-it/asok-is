/**
 * dates.ts — разбор дат формата ДД.ММ.ГГГГ (как их пишет фронт в `Proposal.dueDate`).
 *
 * До ТЗ v19 эта же функция была продублирована как минимум в 4 местах (TaskPlanDashboard,
 * TaskBubbleTimeline, AssigneeTasksPage, NotificationBell) — здесь общая версия для НОВОГО
 * кода (сортировки, УК-27..30). Существующие копии не трогаем: рефакторинг рабочего кода вне
 * объёма задачи, а поведение идентично, так что дублирование безвредно, просто расточительно.
 */
export function parseRuDate(value?: string | null): Date | null {
  if (!value) return null;
  const m = /(\d{2})\.(\d{2})\.(\d{4})/.exec(value);
  return m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])) : null;
}
