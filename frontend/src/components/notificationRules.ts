/**
 * notificationRules.ts — правила формирования уведомлений колокольчика (ДЕФ-30).
 *
 * БТ-420…БТ-424: менеджер по качеству видит подходящие сроки, назначенные задачи и
 * незаполненные профессиональные суждения; топ-менеджер — необработанные заявки и
 * эскалации, ожидающие его решения.
 *
 * Раньше вся логика жила внутри NotificationBell.tsx вперемешку с JSX и не была покрыта
 * ни одним тестом: правило «просрочено / скоро / назначено» и разделение «кто что видит»
 * можно было сломать незаметно. Здесь — чистые функции без React, их и проверяют тесты.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;
/** За сколько до срока задача считается «скоро» (БТ-421 — подходящие сроки). */
export const SOON_WINDOW_MS = 7 * DAY_MS;

/** Минимальная форма меры, нужная правилам. Полный тип — Proposal в governanceSlice. */
export interface NoteProposal {
  id: string;
  status: string;
  execution?: string;
  dueDate?: string;
  escalated?: boolean;
  escalationDecision?: string;
}

/** Дата в формате ДД.ММ.ГГГГ (так её хранит governance) → Date. */
export const parseRuDate = (value?: string): Date | null => {
  if (!value) return null;
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value.trim());
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const date = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  // Отсекаем «32.13.2026»: Date молча переносит такие значения на следующий месяц.
  return date.getDate() === Number(dd) && date.getMonth() === Number(mm) - 1 ? date : null;
};

export type TaskNoteKind =
  | 'escalation-decided'   // решение топ-менеджмента получено — МК отрабатывает
  | 'escalation-pending'   // ждёт решения топ-менеджмента: МК не тревожим
  | 'overdue'
  | 'soon'
  | 'assigned'
  | 'none';                // мера не в работе — уведомления нет

/**
 * Что показать менеджеру по качеству по конкретной мере.
 * Порядок проверок важен: эскалация перекрывает срок — пока решение не получено,
 * напоминать о сроке бессмысленно, задача не в руках МК.
 */
export const taskNoteKind = (p: NoteProposal, now: number): TaskNoteKind => {
  if (p.status !== 'APPROVED' || p.execution === 'DONE') return 'none';
  if (p.escalated) return p.escalationDecision ? 'escalation-decided' : 'escalation-pending';
  const due = parseRuDate(p.dueDate);
  if (!due) return 'assigned';
  const delta = due.getTime() - now;
  if (delta < 0) return 'overdue';
  return delta < SOON_WINDOW_MS ? 'soon' : 'assigned';
};

// Функции обобщённые: правилам достаточно полей NoteProposal, но вызывающий код получает
// НАЗАД свой полный тип (Proposal с systemName, riskTitle и т.д.) без приведения типов.

/** Меры, о которых уведомляем ТОП-МЕНЕДЖЕРА (БТ-422): ждут его решения. */
export const execPendingProposals = <T extends NoteProposal>(proposals: T[]): T[] =>
  proposals.filter((p) => p.status === 'PENDING_APPROVAL');

export const execPendingEscalations = <T extends NoteProposal>(proposals: T[]): T[] =>
  proposals.filter((p) => p.escalated && !p.escalationDecision);

/** Меры, о которых уведомляем МЕНЕДЖЕРА ПО КАЧЕСТВУ (БТ-421). */
export const managerTaskNotes = <T extends NoteProposal>(
  proposals: T[], now: number,
): Array<{ proposal: T; kind: TaskNoteKind }> =>
  proposals
    .map((proposal) => ({ proposal, kind: taskNoteKind(proposal, now) }))
    .filter(({ kind }) => kind !== 'none' && kind !== 'escalation-pending');
