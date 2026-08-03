/**
 * mockAssessments.ts — демо-данные вкладок «Внесение данных» (ТЗ v16, T-47/T-48).
 *
 * Режим 'mock' (презентация без бэкенда) — зеркало live-эндпоинтов:
 *   • DEMO_PERIOD_SUMMARIES  ↔ GET /assessments/periods/summary  — завершённые оценки (T-47);
 *   • demoMetricsOf(periodId)↔ GET /assessments/{id}/metrics     — значения периода на правку;
 *   • DEMO_PENDING_JUDGMENTS ↔ GET /assessments/judgments-pending — метрики без суждения (T-48).
 *
 * Источник значений — SCALE_ASSESSMENT_PAIRS (тот же генератор, что кормит теплокарту, реестр
 * мер и дашборды), поэтому цифры вкладок согласованы с остальным демо. Всё детерминировано:
 * какие суждения «уже внесены», решает хеш пары, а не случайность — состав списка стабилен
 * между перезагрузками.
 */
import { SCALE_ASSESSMENT_PAIRS, type AssessmentPairRow } from './mockScaleData';
import { TOTAL_SUBS } from '../constants/qualityModel';
import { levelLabel } from '../theme/ragPalette';
import type { EditableMetric, PendingJudgment, PeriodSummary } from '../store/api/apiSlice';

/** Кварталы демо-оценок: последний — «текущий», предыдущий — для сравнения/архива. */
export const DEMO_QUARTERS = ['Q1-2026', 'Q2-2026'] as const;
export const DEMO_LATEST_QUARTER = DEMO_QUARTERS[DEMO_QUARTERS.length - 1];

const hash = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
};

const SYSTEM_NAMES = Object.keys(SCALE_ASSESSMENT_PAIRS);
const periodId = (systemName: string, quarter: string) => `demo-${hash(systemName)}-${quarter}`;
const systemId = (systemName: string) => `sys-${hash(systemName)}`;

/** Расчёт X по методике (как backend calculate_metric): прямая A/B, обратная 1 − A/B. */
export function computeX(a: number | null, b: number | null, formula: 'DIRECT' | 'INVERSE'): number | null {
  if (a == null || b == null || b === 0) return null;
  const x = formula === 'INVERSE' ? 1 - a / b : a / b;
  return Math.round(Math.min(1, Math.max(0, x)) * 10000) / 10000;
}

/**
 * Значения периода: за базу берётся срез ИС, для прошлого квартала A сдвигается
 * детерминированным коэффициентом (±6%) — периоды отличаются, но остаются воспроизводимыми.
 */
function pairsOfPeriod(systemName: string, quarter: string): AssessmentPairRow[] {
  const base = SCALE_ASSESSMENT_PAIRS[systemName] ?? [];
  if (quarter === DEMO_LATEST_QUARTER) return base;
  return base.map((p) => {
    if (p.a == null || p.b == null) return p;
    const k = 0.94 + (hash(`${systemName}|${quarter}|${p.subcharacteristic}`) % 13) / 100; // 0.94..1.06
    const a = Math.max(0, Math.min(p.b, Math.round(p.a * k)));
    return { ...p, a, x: computeX(a, p.b, p.formula) ?? -1 };
  });
}

/**
 * Оценки по системам и кварталам. Все заполнены полностью (31/31) и завершены; каждая 4-я ИS
 * в прошлом квартале уже открыта на корректировку (CALCULATED) — во вкладке видно оба статуса.
 */
export const DEMO_PERIOD_SUMMARIES: PeriodSummary[] = SYSTEM_NAMES.flatMap((name, idx) =>
  DEMO_QUARTERS.map((quarter): PeriodSummary => ({
    id: periodId(name, quarter),
    system_id: systemId(name),
    system_name: name,
    period: quarter,
    status: quarter !== DEMO_LATEST_QUARTER && idx % 4 === 0 ? 'CALCULATED' : 'COMPLETE',
    filled: TOTAL_SUBS,
    total: TOTAL_SUBS,
    complete: true,
  })),
);

const PERIOD_INDEX = new Map(DEMO_PERIOD_SUMMARIES.map((p) => [p.id, p]));
export const demoPeriodById = (id: string): PeriodSummary | undefined => PERIOD_INDEX.get(id);

/** Строки значений периода в формате GET /assessments/{id}/metrics. */
export function demoMetricsOf(id: string): EditableMetric[] {
  const period = PERIOD_INDEX.get(id);
  if (!period) return [];
  return pairsOfPeriod(period.system_name, period.period).map((p, i): EditableMetric => {
    const unmeasurable = p.x < 0;
    return {
      id: `${id}-${i}`,
      name: `${p.characteristic} / ${p.subcharacteristic}`,
      characteristic: p.characteristic,
      subcharacteristic: p.subcharacteristic,
      metric_id: i + 1,
      description: '',
      val_a: p.a,
      val_b: p.b,
      expert_comment: unmeasurable ? 'Нет базы измерения B: источник данных не подключён.' : '',
      unmeasurable,
      calculatedX: unmeasurable ? null : p.x,
      qualityLevel: unmeasurable ? 'Невозможно измерить' : levelLabel(Math.round(p.x * 100)),
    };
  });
}

/**
 * Метрики без профессионального суждения (последний квартал каждой ИС — правило DEF-14).
 * Считается, что суждение уже внесено по 2/3 пар; «невозможно измерить» всегда ждёт суждения
 * (по такой метрике обязательны причина и решение менеджера по качеству).
 */
export const DEMO_PENDING_JUDGMENTS: PendingJudgment[] = SYSTEM_NAMES.flatMap((name) => {
  const id = periodId(name, DEMO_LATEST_QUARTER);
  return pairsOfPeriod(name, DEMO_LATEST_QUARTER)
    .filter((p) => p.x < 0 || hash(`${name}|${p.subcharacteristic}`) % 3 === 0)
    .map((p): PendingJudgment => ({
      period_id: id,
      system_id: systemId(name),
      system_name: name,
      period: DEMO_LATEST_QUARTER,
      characteristic: p.characteristic,
      subcharacteristic: p.subcharacteristic,
      score_pct: p.x < 0 ? -1 : Math.round(p.x * 100),
      quality_level: p.x < 0 ? 'Невозможно измерить' : levelLabel(Math.round(p.x * 100)),
      expert_comment: p.x < 0 ? 'Нет базы измерения B: источник данных не подключён.' : null,
    }));
}).sort((a, b) =>
  (a.score_pct - b.score_pct)
  || a.system_name.localeCompare(b.system_name)
  || a.characteristic.localeCompare(b.characteristic)
  || a.subcharacteristic.localeCompare(b.subcharacteristic));
