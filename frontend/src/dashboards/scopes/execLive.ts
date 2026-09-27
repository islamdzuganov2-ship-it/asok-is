/**
 * execLive.ts — сборка данных управленческого дашборда из ответа /reports/executive-dashboard
 * (LLM-режим). Вынесено из ExecScope.tsx — потолок размера модуля (check-size.mjs).
 */
import type { ExecSystemInsight, ExecutiveDashboardData } from '../../data/mockDashboards';

const BUCKET_SCORE = [-1, 10, 30, 50, 70, 90];

export interface LiveDashboard {
  /** УК-03: шкала прочтения интегральной цифры (уровень, цель, дельта). */
  scoreScale?: import('../../components/ScoreScale').ScoreScaleData | null;
  globalHealthScore: number;
  /** УК-02: балл каждой ИС — та же свёртка бэкенда, что у глобальной цифры и Excel. */
  systemScores?: Record<string, number | null>;
  aiInsights: string;
  heatmapData?: [number, number, number][];
  xAxisLabels?: string[];
  yAxisLabels?: string[];
  problematicSystems?: { id: string; name: string; criticality: string; lowMetricsCount: number; owner?: string | null; ownerUserId?: string | null }[];
  periodsUsed?: { distinct: string[]; earliest: string | null; latest: string | null; bySystem: Record<string, string> };
}

/** Сборка структуры дашборда из реального ответа API (LLM-режим). Перенесено дословно. */
export function buildExecFromLive(live: LiveDashboard | null, charWeights: Record<string, number>): ExecutiveDashboardData {
  const empty: ExecutiveDashboardData = {
    globalIndex: live ? Math.round(live.globalHealthScore) : 0,
    systems: [], heatmap: { characteristics: [], rows: [] },
    techDebt: { resolvedPct: 0, period: '', note: '' },
  };
  if (!live || !live.yAxisLabels?.length || !live.xAxisLabels?.length) return empty;

  const chars = live.xAxisLabels;
  const sysNames = live.yAxisLabels;
  const matrix: number[][] = sysNames.map(() => chars.map(() => 0));
  (live.heatmapData ?? []).forEach(([x, y, b]) => { if (matrix[y] && x < chars.length) matrix[y][x] = b; });
  const critMap = new Map((live.problematicSystems ?? []).map((s) => [s.name, s.criticality]));
  const ownerMap = new Map((live.problematicSystems ?? []).map((s) => [s.name, s.owner]));

  const rows = sysNames.map((sys, y) => ({
    system: sys,
    cells: chars.map((_, x) => ({ score: BUCKET_SCORE[matrix[y][x]] ?? -1 })),
  }));

  const systems: ExecSystemInsight[] = sysNames.map((sys, y) => {
    const measured = chars
      .map((c, x) => ({ x, s: BUCKET_SCORE[matrix[y][x]] ?? -1, w: charWeights[c] ?? 0 }))
      .filter((m) => m.s >= 0);
    const weightApplied = measured.reduce((a, m) => a + m.w, 0);
    // УК-02: балл ИС берётся из единой свёртки бэкенда; приближение по «вёдрам» теплокарты —
    // только для старого ответа без systemScores.
    const backendScore = live.systemScores?.[sys];
    const score = backendScore != null ? Math.round(backendScore) : weightApplied > 0
      ? Math.round(measured.reduce((a, m) => a + m.w * m.s, 0) / weightApplied)
      : (measured.length ? Math.round(measured.reduce((a, m) => a + m.s, 0) / measured.length) : 0);
    let weakIdx = 0, weakScore = 101;
    chars.forEach((_, x) => {
      const s = BUCKET_SCORE[matrix[y][x]] ?? -1;
      if (s >= 0 && s < weakScore) { weakScore = s; weakIdx = x; }
    });
    const weakChar = chars[weakIdx] ?? '';
    return {
      id: `live-${y}`, name: sys, score,
      criticality: (critMap.get(sys) as ExecSystemInsight['criticality']) ?? 'BUSINESS OPERATIONAL',
      weakCharacteristic: weakChar,
      aiSummary: `Интегральная оценка качества — ${score}%. Наиболее просевшая характеристика — ${weakChar} (${weakScore <= 100 ? weakScore : '—'}%).`,
      recommendation: 'Сформировать меры по просевшим характеристикам.',
      owner: ownerMap.get(sys) || 'не назначен',
      escalateTo: 'CTO',
      actions: ['Назначить ответственного и срок', 'Зафиксировать меру в плане качества', 'Включить контроль выполнения'],
    };
  });

  return {
    globalIndex: Math.round(live.globalHealthScore),
    systems,
    heatmap: { characteristics: chars, rows },
    techDebt: { resolvedPct: 0, period: '', note: '' },
  };
}
