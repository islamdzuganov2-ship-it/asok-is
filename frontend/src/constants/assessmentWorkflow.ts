/**
 * assessmentWorkflow.ts — чистые правила вкладок «Корректировка оценки» (T-47) и
 * «Внесение проф. суждения» (T-48). Зеркало серверных правил (backend `app/shared/periods.py`
 * и `GET /assessments/judgments-pending`), вынесенное из компонентов, чтобы приёмка ТЗ
 * проверялась юнит-тестами без DOM (та же практика, что `applyEdit` в governanceSlice).
 *
 * Здесь НЕТ обращений к API и React — только детерминированные функции над данными.
 */
import type { EditableMetric, JudgmentItem, PendingJudgment } from '../store/api/apiSlice';
import { formulaFor } from './qualityModel';
import { levelLabel } from '../theme/ragPalette';

/** Статусы периода оценки (совпадают с backend app/shared/periods.py). */
export const PERIOD_STATUS = {
  DRAFT: 'DRAFT',
  CALCULATED: 'CALCULATED',
  COMPLETE: 'COMPLETE',
} as const;

/**
 * T-47: завершённая оценка закрыта на правку — значения правятся только после разблокировки
 * (POST /assessments/{id}/reopen). Бэкенд отвечает 409 на попытку записи в COMPLETE-период,
 * фронт блокирует поля заранее.
 */
export const isPeriodLocked = (status?: string): boolean => status === PERIOD_STATUS.COMPLETE;

/** Оценка считается завершённой, когда заполнены все подхарактеристики модели. */
export const isPeriodComplete = (filled: number, total: number): boolean =>
  total > 0 && filled >= total;

/** Расчёт X по методике (как backend calculate_metric): прямая A/B, обратная 1 − A/B. */
export function computeX(a: number | null, b: number | null, formula: 'DIRECT' | 'INVERSE'): number | null {
  if (a == null || b == null || b === 0) return null;
  const x = formula === 'INVERSE' ? 1 - a / b : a / b;
  return Math.round(Math.min(1, Math.max(0, x)) * 10000) / 10000;
}

/**
 * T-47: строка таблицы корректировки = сохранённое значение + текущая правка, с немедленным
 * пересчётом X и уровня (пользователь видит эффект до сохранения; после сохранения те же
 * значения приходят с бэкенда). «Невозможно измерить» обнуляет A/B — расчёт не делается.
 */
export function recalcMetricRow(row: EditableMetric, patch?: Partial<EditableMetric>): EditableMetric {
  if (!patch) return row;
  const merged = { ...row, ...patch };
  if (merged.unmeasurable) {
    return { ...merged, val_a: null, val_b: null, calculatedX: null, qualityLevel: 'Невозможно измерить' };
  }
  const x = computeX(
    merged.val_a,
    merged.val_b,
    formulaFor(merged.characteristic || '', merged.subcharacteristic || ''),
  );
  return { ...merged, calculatedX: x, qualityLevel: x == null ? null : levelLabel(Math.round(x * 100)) };
}

/** «Невозможно измерить» требует причину — без неё правку сохранять нельзя (T-55). */
export const rowsMissingReason = (rows: EditableMetric[]): EditableMetric[] =>
  rows.filter((r) => r.unmeasurable && !(r.expert_comment || '').trim());

// ─── T-48: метрики без профессионального суждения ───

const KEY_SEP = '|||';

/** Ключ строки «оценка ↔ суждение»: период + пара модели (связка, которую сохраняет бэкенд). */
export const pendingJudgmentKey = (r: PendingJudgment): string =>
  [r.period_id, r.characteristic, r.subcharacteristic].join(KEY_SEP);

/** Приёмка T-48: внесённая запись уходит из списка «без суждения». */
export const withoutJudged = (rows: PendingJudgment[], judgedKeys: Set<string>): PendingJudgment[] =>
  rows.filter((r) => !judgedKeys.has(pendingJudgmentKey(r)));

/**
 * Черновики (ключ строки → текст) → пачки суждений по периодам: PUT /{period_id}/judgments
 * принимает список пар, поэтому на каждый период уходит один запрос. Пустые тексты отбрасываются.
 */
export function groupJudgmentsByPeriod(drafts: Record<string, string>): Map<string, JudgmentItem[]> {
  const byPeriod = new Map<string, JudgmentItem[]>();
  Object.entries(drafts).forEach(([key, text]) => {
    if (!(text || '').trim()) return;
    const [periodId, characteristic, subcharacteristic] = key.split(KEY_SEP);
    const items = byPeriod.get(periodId) ?? [];
    items.push({ characteristic, subcharacteristic, judgment_text: text.trim() });
    byPeriod.set(periodId, items);
  });
  return byPeriod;
}
