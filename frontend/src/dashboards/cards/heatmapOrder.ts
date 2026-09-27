/**
 * heatmapOrder.ts — порядок строк теплокарты (ТЗ v19 п.12, УК-29).
 *
 * Клик по заголовку характеристики уже переупорядочивает ИС по её баллу (execHeatmapCard).
 * Здесь — остальные порядки из УК-29: по итоговому баллу ИС, по критичности, по числу низких
 * характеристик и по деньгам под риском (п.4). Тот же компаратор, что у таблиц (УК-28):
 * «нет данных» — всегда в конце, сортировка стабильна.
 */
import { sortRows } from '../../theme/table';

export type RowOrder = 'score' | 'criticality' | 'low' | 'money';

export const ROW_ORDER_OPTIONS: { value: RowOrder; label: string }[] = [
  { value: 'score', label: 'по баллу ИС' },
  { value: 'criticality', label: 'по критичности' },
  { value: 'low', label: 'по числу низких' },
  { value: 'money', label: 'по деньгам под риском' },
];

const CRIT_RANK: Record<string, number> = { 'MISSION CRITICAL': 0, 'BUSINESS CRITICAL': 1, 'BUSINESS OPERATIONAL': 2 };
const LOW_BOUND = 41;   // «ниже среднего» и «низкий уровень» — та же граница, что у низких метрик

export interface HeatRowLike { system: string; cells: { score: number }[] }

export interface RowFacts {
  scoreOf: (system: string) => number | null;
  criticalityOf: (system: string) => string | null;
  /** Σ ALE под риском по ИС; null — денежный слой не загружен (демо). */
  moneyOf: (system: string) => number | null;
}

export const lowCount = (row: HeatRowLike): number =>
  row.cells.filter((c) => c.score >= 0 && c.score < LOW_BOUND).length;

export function orderHeatRows<T extends HeatRowLike>(rows: readonly T[], order: RowOrder, facts: RowFacts): T[] {
  switch (order) {
    case 'criticality': {
      // Критичность, внутри класса — худший балл первым.
      const byScore = sortRows(rows, (r) => facts.scoreOf(r.system), 'ascend');
      return sortRows(byScore, (r) => CRIT_RANK[facts.criticalityOf(r.system) ?? ''] ?? null, 'ascend');
    }
    case 'low':
      return sortRows(rows, (r: T) => lowCount(r), 'descend');
    case 'money':
      return sortRows(rows, (r) => facts.moneyOf(r.system), 'descend');
    case 'score':
    default:
      return sortRows(rows, (r) => facts.scoreOf(r.system), 'ascend');
  }
}

const KEY = 'asok_heatmap_row_order';

export const loadRowOrder = (): RowOrder => {
  try {
    const v = localStorage.getItem(KEY);
    return ROW_ORDER_OPTIONS.some((o) => o.value === v) ? (v as RowOrder) : 'score';
  } catch { return 'score'; }
};

export const saveRowOrder = (v: RowOrder) => {
  try { localStorage.setItem(KEY, v); } catch { /* приватное окно — выбор просто не запомнится */ }
};
