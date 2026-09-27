/**
 * managementContour.test.ts — чистая логика экранов ТЗ-19 «Управленческий контур».
 *
 * УК-03 — шкала прочтения интегрального балла; УК-29 — порядок строк теплокарты;
 * УК-34 — язык карточек по роли; УК-38/40 — «В работу» и одно поле «Ответственный (ОМ)».
 */
import { describe, expect, it } from 'vitest';
import { deltaText, levelOf, localScale } from '../components/ScoreScale';
import { lowCount, orderHeatRows } from '../dashboards/cards/heatmapOrder';
import { langModeFor } from '../components/LangModeToggle';
import { isSingleOwner, toIsoDate } from '../components/MeasureWorkPanel';

describe('УК-03: шкала прочтения', () => {
  it('уровень словами по тем же порогам, что у метрики', () => {
    expect(levelOf(20)).toBe('Низкий уровень');
    expect(levelOf(21)).toBe('Ниже среднего');
    expect(levelOf(62)).toBe('Выше среднего');
    expect(levelOf(81)).toBe('Высокий уровень');
    expect(levelOf(null)).toBe('Нет данных');
  });

  it('дельта подписывается базой сравнения, без дельты — пусто', () => {
    const s = { ...localScale(62), delta: 3, comparedSystems: 3, totalSystems: 4 };
    expect(deltaText(s)).toBe('+3.0 п.п. к прошлому периоду (по 3 из 4 ИС)');
    expect(deltaText(localScale(62))).toBeNull();
    expect(localScale(62).gapToTarget).toBe(-19);
  });
});

describe('УК-29: порядок строк теплокарты', () => {
  const rows = [
    { system: 'A', cells: [{ score: 30 }, { score: 90 }] },
    { system: 'B', cells: [{ score: 10 }, { score: 20 }] },
    { system: 'C', cells: [{ score: -1 }, { score: 95 }] },
  ];
  const facts = {
    scoreOf: (s: string) => ({ A: 60, B: 15, C: null } as Record<string, number | null>)[s],
    criticalityOf: (s: string) => ({ A: 'BUSINESS OPERATIONAL', B: 'BUSINESS CRITICAL', C: 'MISSION CRITICAL' } as Record<string, string>)[s],
    moneyOf: (s: string) => ({ A: 500, B: null, C: 900 } as Record<string, number | null>)[s],
  };

  it('по баллу — худшие первыми, без данных в конце', () => {
    expect(orderHeatRows(rows, 'score', facts).map((r) => r.system)).toEqual(['B', 'A', 'C']);
  });
  it('по критичности — Mission Critical первыми', () => {
    expect(orderHeatRows(rows, 'criticality', facts).map((r) => r.system)).toEqual(['C', 'B', 'A']);
  });
  it('по числу низких характеристик (невозможно измерить — не низкая)', () => {
    expect(rows.map(lowCount)).toEqual([1, 2, 0]);
    expect(orderHeatRows(rows, 'low', facts).map((r) => r.system)).toEqual(['B', 'A', 'C']);
  });
  it('по деньгам под риском — больше первыми, без денежного слоя в конце', () => {
    expect(orderHeatRows(rows, 'money', facts).map((r) => r.system)).toEqual(['C', 'A', 'B']);
  });
});

describe('УК-34: язык карточек', () => {
  it('по роли, пока пользователь не выбрал сам', () => {
    expect(langModeFor(null, 'CEO')).toBe('executive');
    expect(langModeFor(null, 'QUALITY_MANAGER')).toBe('technical');
    expect(langModeFor('technical', 'CEO')).toBe('technical');
  });
});

describe('УК-38/40: «В работу» и ответственный (ОМ)', () => {
  it('одно поле, если ответственный и исполнитель — один человек', () => {
    expect(isSingleOwner({ ownerUserId: 'u1', executedByUserId: 'u1', owner: 'Иванов', executedBy: undefined })).toBe(true);
    expect(isSingleOwner({ ownerUserId: 'u1', executedByUserId: null, owner: 'Иванов', executedBy: undefined })).toBe(true);
    expect(isSingleOwner({ ownerUserId: 'u1', executedByUserId: 'u2', owner: 'Иванов', executedBy: 'Петров' })).toBe(false);
  });
  it('срок ДД.ММ.ГГГГ → значение поля даты', () => {
    expect(toIsoDate('15.12.2026')).toBe('2026-12-15');
    expect(toIsoDate(undefined)).toBe('');
  });
});
