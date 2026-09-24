/**
 * lensMath.ts — свёртка денежного слоя теплокарты по ИС для денежной линзы (ТЗ-21 §3.1).
 *
 * Денежный слой (`GET /risk-events/heatmap-money-layer`) отдаётся по ячейкам «ИС ×
 * характеристика». Шторке «Где мы уязвимы?» нужна строка на ИС в выбранной линзе:
 *  • ALE и ΔALE по ИС — сумма по её ячейкам;
 *  • покрытие мерами — средневзвешенное по ALE ячеек, а не простое среднее процентов:
 *    ячейка на 10 тыс. ₽ с покрытием 0% не должна весить столько же, сколько ячейка на 10 млн.
 */
import type { Lens } from '../../store/slice/sliceTypes';

export interface MoneyCell {
  systemName: string;
  characteristic: string;
  totalAle: number;
  totalDeltaAle: number;
  coveragePct: number;
}

export interface SystemMoneyRow {
  system: string;
  ale: number;
  delta: number;
  /** null — у ИС нет ALE, долю покрытия считать не от чего (не 0%). */
  coveragePct: number | null;
}

export function moneyBySystem(cells: readonly MoneyCell[]): SystemMoneyRow[] {
  const acc = new Map<string, { ale: number; delta: number; covered: number }>();
  for (const c of cells) {
    const a = acc.get(c.systemName) ?? { ale: 0, delta: 0, covered: 0 };
    a.ale += c.totalAle;
    a.delta += c.totalDeltaAle;
    a.covered += c.totalAle * (c.coveragePct / 100);
    acc.set(c.systemName, a);
  }
  return [...acc.entries()].map(([system, a]) => ({
    system,
    ale: a.ale,
    delta: a.delta,
    coveragePct: a.ale > 0 ? Math.round((a.covered / a.ale) * 1000) / 10 : null,
  }));
}

/**
 * Порядок строк в линзе: «где мы уязвимы» — сверху самое опасное. ALE и ΔALE — по убыванию,
 * покрытие — по возрастанию (непокрытое наверх); ИС без ALE в линзе покрытия — в конце.
 */
export function sortForLens(rows: readonly SystemMoneyRow[], lens: Lens): SystemMoneyRow[] {
  const out = [...rows];
  if (lens === 'delta') return out.sort((a, b) => b.delta - a.delta);
  if (lens === 'coverage') {
    return out.sort((a, b) => {
      if (a.coveragePct === null) return b.coveragePct === null ? 0 : 1;
      if (b.coveragePct === null) return -1;
      return a.coveragePct - b.coveragePct;
    });
  }
  return out.sort((a, b) => b.ale - a.ale);
}
