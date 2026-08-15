/**
 * Потолок размера модулей (ДЕФ-39).
 *
 * Ревью зафиксировало компоненты по 30–43 КБ: один файл — это несколько экранов, таблиц и
 * модалок сразу. Разово декомпозировать их — отдельная задача со своим регрессом; здесь
 * закрыта та часть дефекта, которая позволяла долгу расти дальше.
 *
 * Правило: файл из списка не может стать больше, чем сейчас; новый файл не может сразу
 * родиться крупнее общего потолка. При декомпозиции число в списке уменьшают — второй тест
 * этого требует, иначе бюджет превратился бы в вечное разрешение.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { globSync } from 'node:fs';

const SRC = resolve(fileURLToPath(new URL('../', import.meta.url)));

/** Общий потолок для НОВЫХ файлов, КБ. */
const DEFAULT_LIMIT_KB = 20;

/** Долг на 2026-08-15: фактический размер, КБ. Уменьшать при декомпозиции. */
const SIZE_BUDGET_KB: Record<string, number> = {
  'pages/RiskEconomicsPage.tsx': 42,
  'pages/NewAssessmentPage.tsx': 36,
  'data/mockScaleData.ts': 33,
  'pages/AiAssessmentPage.tsx': 32,
  'pages/ExcelReportsPage.tsx': 32,
  'store/api/apiSlice.ts': 31,
  'pages/dashboard/TaskPlanDashboard.tsx': 30,
  'pages/dashboard/ExecutiveDashboard.tsx': 27,
  'pages/dashboard/IncidentsAnalyticsPage.tsx': 27,
  'pages/dashboard/ManagerDashboard.tsx': 27,
  'pages/DashboardPage.tsx': 24,
  'store/slices/governanceSlice.ts': 20,
};

const sources = (): string[] =>
  globSync('**/*.{ts,tsx}', { cwd: SRC })
    .filter((p) => !p.includes('__tests__'))
    .map((p) => p.split('\\').join('/'));

const sizeKb = (rel: string): number => Math.round(statSync(resolve(SRC, rel)).size / 1024);

describe('размер модулей', () => {
  it('ни один файл не превышает свой потолок', () => {
    const offenders: string[] = [];
    for (const rel of sources()) {
      const kb = sizeKb(rel);
      const limit = SIZE_BUDGET_KB[rel] ?? DEFAULT_LIMIT_KB;
      if (kb > limit) offenders.push(`${rel}: ${kb} КБ при потолке ${limit} КБ`);
    }
    expect(offenders, `Файл вырос сверх бюджета — вынесите часть в отдельный модуль,\n`
      + `а не поднимайте потолок:\n  ${offenders.join('\n  ')}`).toEqual([]);
  });

  it('бюджет не завышен относительно факта', () => {
    const stale: string[] = [];
    for (const [rel, budget] of Object.entries(SIZE_BUDGET_KB)) {
      let kb: number;
      try {
        kb = sizeKb(rel);
      } catch {
        stale.push(`${rel}: файла нет — уберите из бюджета`);
        continue;
      }
      if (kb < budget - 1) stale.push(`${rel}: фактически ${kb} КБ при бюджете ${budget} КБ — опустите бюджет`);
    }
    expect(stale, `Бюджет размеров разошёлся с кодом:\n  ${stale.join('\n  ')}`).toEqual([]);
  });
});
