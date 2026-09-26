/**
 * tables.test.ts — сортировка и единая обёртка таблиц (ТЗ v19 п.12, УК-28, УК-30).
 *
 *  • «нет данных» всегда в конце — и по возрастанию, и по убыванию (antd переворачивает знак
 *    компаратора при убывании, компаратор это учитывает);
 *  • «ё» = «е», регистр не важен, числа — арифметически;
 *  • обёртка AppTable добавляет сортировку каждой колонке с данными и выгружает CSV в порядке
 *    сортировки;
 *  • храповик: новый файл не может взять голую antd-таблицу — только AppTable. Список ниже —
 *    долг, который уменьшается при переводе экрана на обёртку и не может расти.
 */
import { describe, expect, it } from 'vitest';
import { compareValues, sorterFor, sortRows } from '../theme/table';
import { toCsv, withSorters, type AppColumn } from '../components/AppTable';

/** Эмуляция antd: при убывании знак компаратора переворачивается целиком. */
const antdSort = <T,>(rows: T[], cmp: (a: T, b: T, d?: 'ascend' | 'descend') => number, dir: 'ascend' | 'descend') =>
  [...rows].sort((a, b) => (dir === 'descend' ? -1 : 1) * cmp(a, b, dir));

describe('компаратор (УК-28)', () => {
  const rows = [{ v: 3 }, { v: null }, { v: 10 }, { v: undefined }, { v: 1 }];
  const cmp = sorterFor((r: { v: number | null | undefined }) => r.v);

  it('пустые — в конце при любом направлении', () => {
    expect(antdSort(rows, cmp, 'ascend').map((r) => r.v)).toEqual([1, 3, 10, null, undefined]);
    const desc = antdSort(rows, cmp, 'descend').map((r) => r.v);
    expect(desc.slice(0, 3)).toEqual([10, 3, 1]);
    expect(desc.slice(3).every((v) => v == null)).toBe(true);
  });

  it('текст по-русски: ё = е, регистр не важен, числа внутри строк — по значению', () => {
    expect(compareValues('ёлка', 'елка')).toBe(0);
    expect(compareValues('Иванов', 'иванов')).toBe(0);
    expect(compareValues('ИС 2', 'ИС 10')).toBeLessThan(0);
  });

  it('sortRows стабилен и держит пустые в конце', () => {
    const r = [{ k: 'a', v: 2 }, { k: 'b', v: null }, { k: 'c', v: 2 }, { k: 'd', v: 1 }];
    expect(sortRows(r, (x) => x.v, 'descend').map((x) => x.k)).toEqual(['a', 'c', 'd', 'b']);
    expect(sortRows(r, (x) => x.v, 'ascend').map((x) => x.k)).toEqual(['d', 'a', 'c', 'b']);
  });
});

describe('AppTable (УК-30)', () => {
  type Row = { name: string; score: number | null; action?: string };
  const columns: AppColumn<Row>[] = [
    { title: 'ИС', dataIndex: 'name' },
    { title: 'Балл', dataIndex: 'score' },
    { title: 'Действие', key: 'act', sortable: false },
  ];

  it('каждая колонка с данными получает сортировку, служебная — нет', () => {
    const out = withSorters(columns);
    expect(typeof out[0].sorter).toBe('function');
    expect(typeof out[1].sorter).toBe('function');
    expect(out[2].sorter).toBeUndefined();
  });

  it('CSV: заголовки, разделитель «;», экранирование и BOM', () => {
    const csv = toCsv([{ name: 'АБС; Core', score: 62 }, { name: 'ДБО', score: null }], columns);
    expect(csv.startsWith('﻿')).toBe(true);
    const lines = csv.slice(1).split('\n');
    expect(lines[0]).toBe('ИС;Балл');
    expect(lines[1]).toBe('"АБС; Core";62');
    expect(lines[2]).toBe('ДБО;');
  });
});

describe('храповик: новые таблицы — только через AppTable (УК-30)', () => {
  const LEGACY = new Set([
    'components/AppTable.tsx', 'components/AnalystLoadPanel.tsx', 'components/AssessmentCorrectionPanel.tsx',
    'components/DataUploadPanel.tsx', 'components/EmployeeEffectivenessCard.tsx', 'components/JudgmentEntryPanel.tsx',
    'components/MeasuresAiAnalyticsCard.tsx', 'components/TechDebtCard.tsx', 'dashboards/cards/analyticsCards.tsx',
    'dashboards/cards/econCards.tsx', 'dashboards/cards/econManagersCard.tsx', 'dashboards/cards/incidentsCards.tsx',
    'dashboards/cards/managerCards.tsx', 'dashboards/cards/myTasksCards.tsx', 'dashboards/cards/taskPlanCards.tsx',
    'dashboards/cockpit/ceoTiles.tsx', 'dashboards/cockpit/ctoTiles.tsx', 'dashboards/riskWidgets.tsx',
    'dashboards/scopes/analyticsModals.tsx', 'dashboards/scopes/execListModals.tsx', 'pages/AiAssessmentPage.tsx',
    'pages/ExcelReportsPage.tsx', 'pages/ExpertReviewPage.tsx', 'pages/MetricsInputPage.tsx',
    'pages/NewAssessmentPage.tsx', 'pages/RiskBasePage.tsx', 'pages/admin/AuditLogPage.tsx',
    'pages/admin/LlmQualityPage.tsx', 'pages/admin/MeasureDepartmentsPage.tsx', 'pages/admin/UsersAdminPage.tsx',
    'pages/admin/WeightsEditorPage.tsx', 'pages/riskEconomics/BenchmarksPanel.tsx', 'pages/riskEconomics/ClosureTab.tsx',
    'pages/riskEconomics/ReferencesTab.tsx', 'pages/riskEconomics/RiskEventsTab.tsx',
  ]);
  const sources = import.meta.glob('../**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  const RAW_TABLE = /import\s*\{[^}]*\bTable\b[^}]*\}\s*from\s*'antd'/;

  it('голая antd-таблица только в файлах-долге', () => {
    const offenders = Object.entries(sources)
      .filter(([path]) => !path.includes('__tests__'))
      .filter(([, text]) => RAW_TABLE.test(text))
      .map(([path]) => path.replace(/^\.\.\//, ''))
      .filter((path) => !LEGACY.has(path));
    expect(offenders).toEqual([]);
  });
});
