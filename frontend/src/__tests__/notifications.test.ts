/**
 * Правила уведомлений колокольчика (ДЕФ-30 / БТ-420…БТ-424).
 *
 * Раздел был реализован без ТЗ и без единого теста: правило «просрочено / скоро /
 * назначено» и разделение «кто что видит» можно было сломать незаметно.
 */
import { describe, it, expect } from 'vitest';
import {
  taskNoteKind, parseRuDate, managerTaskNotes, execPendingProposals, execPendingEscalations,
  SOON_WINDOW_MS, DAY_MS, type NoteProposal,
} from '../components/notificationRules';

const NOW = new Date(2026, 7, 15).getTime();   // 15.08.2026
const ru = (offsetDays: number): string => {
  const d = new Date(NOW + offsetDays * DAY_MS);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
};
const task = (over: Partial<NoteProposal> = {}): NoteProposal =>
  ({ id: 'p1', status: 'APPROVED', ...over });

describe('разбор даты срока', () => {
  it('читает формат ДД.ММ.ГГГГ', () => {
    expect(parseRuDate('01.09.2026')?.getMonth()).toBe(8);
    expect(parseRuDate('31.12.2026')?.getDate()).toBe(31);
  });

  it('не принимает мусор и несуществующие даты', () => {
    for (const bad of ['', undefined, '2026-09-01', '32.01.2026', '01.13.2026', 'скоро']) {
      expect(parseRuDate(bad as string | undefined)).toBeNull();
    }
  });
});

describe('уведомления менеджера по качеству', () => {
  it('просроченная задача помечается как просроченная', () => {
    expect(taskNoteKind(task({ dueDate: ru(-1) }), NOW)).toBe('overdue');
  });

  it('срок в пределах недели — «скоро»', () => {
    expect(taskNoteKind(task({ dueDate: ru(3) }), NOW)).toBe('soon');
  });

  it('граница окна «скоро» проверяется строго', () => {
    // ровно 7 суток — уже вне окна, иначе «скоро» показывалось бы на неделю раньше срока
    const atBoundary = new Date(NOW + SOON_WINDOW_MS);
    const boundary = `${String(atBoundary.getDate()).padStart(2, '0')}.`
      + `${String(atBoundary.getMonth() + 1).padStart(2, '0')}.${atBoundary.getFullYear()}`;
    expect(taskNoteKind(task({ dueDate: boundary }), NOW)).toBe('assigned');
    expect(taskNoteKind(task({ dueDate: ru(6) }), NOW)).toBe('soon');
  });

  it('дальний срок — обычная назначенная задача', () => {
    expect(taskNoteKind(task({ dueDate: ru(30) }), NOW)).toBe('assigned');
  });

  it('задача без срока всё равно попадает в уведомления', () => {
    expect(taskNoteKind(task({}), NOW)).toBe('assigned');
  });

  it('выполненная задача не тревожит', () => {
    expect(taskNoteKind(task({ dueDate: ru(-5), execution: 'DONE' }), NOW)).toBe('none');
  });

  it('неодобренная мера не является задачей МК', () => {
    expect(taskNoteKind(task({ status: 'PENDING_APPROVAL', dueDate: ru(-5) }), NOW)).toBe('none');
  });

  it('эскалация без решения не тревожит МК — мяч на стороне топ-менеджмента', () => {
    const p = task({ escalated: true, dueDate: ru(-10) });
    expect(taskNoteKind(p, NOW)).toBe('escalation-pending');
    expect(managerTaskNotes([p], NOW)).toHaveLength(0);
  });

  it('после решения по эскалации задача возвращается к МК', () => {
    const p = task({ escalated: true, escalationDecision: 'REQUEST_MEASURES' });
    expect(taskNoteKind(p, NOW)).toBe('escalation-decided');
    expect(managerTaskNotes([p], NOW)).toHaveLength(1);
  });

  it('эскалация перекрывает просрочку', () => {
    // Иначе МК получал бы «просрочено» по задаче, которую сам же и эскалировал.
    expect(taskNoteKind(task({ escalated: true, dueDate: ru(-30) }), NOW)).toBe('escalation-pending');
  });
});

describe('уведомления топ-менеджера (БТ-422)', () => {
  const proposals: NoteProposal[] = [
    { id: 'a', status: 'PENDING_APPROVAL' },
    { id: 'b', status: 'APPROVED' },
    { id: 'c', status: 'APPROVED', escalated: true },
    { id: 'd', status: 'APPROVED', escalated: true, escalationDecision: 'IGNORE' },
  ];

  it('показываются только необработанные заявки', () => {
    expect(execPendingProposals(proposals).map((p) => p.id)).toEqual(['a']);
  });

  it('показываются только эскалации без решения', () => {
    expect(execPendingEscalations(proposals).map((p) => p.id)).toEqual(['c']);
  });

  it('решённая эскалация топ-менеджера больше не тревожит', () => {
    expect(execPendingEscalations(proposals).map((p) => p.id)).not.toContain('d');
  });
});
