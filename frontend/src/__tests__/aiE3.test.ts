/**
 * aiE3.test.ts — клиентская логика этапа E3 контура СИИ (ГОСТ Р 59898-2021; BL-001):
 * разбор значений признака для проверки выбросов и подпись согласованности экспертной группы.
 */
import { describe, expect, it } from 'vitest';
import { kendallVerdict, parseNumbers } from '../pages/aiAssessment/aiE3Api';

describe('значения признака (выбросы)', () => {
  it('пробел, «;» и перевод строки — разделители; запятая — десятичная', () => {
    expect(parseNumbers('10 11;12\n1,5  abc 100')).toEqual([10, 11, 12, 1.5, 100]);
    expect(parseNumbers('')).toEqual([]);
  });
});

describe('подпись конкордации Кендалла', () => {
  const base = { m: 3, n: 4, chi2: 9, df: 3, p_value: 0.029, threshold: 0.5, note: null };
  it('значимая высокая согласованность', () => {
    expect(kendallVerdict({ ...base, w: 1, consistent: true })).toContain('высокая');
    expect(kendallVerdict({ ...base, w: 1, consistent: true })).toContain('(значима)');
  });
  it('несогласованная группа и недостаток данных', () => {
    expect(kendallVerdict({ ...base, w: 0.2, consistent: false })).toContain('группа не согласована');
    expect(kendallVerdict({ ...base, w: null, consistent: false, note: 'нужно не меньше двух экспертов' }))
      .toBe('нужно не меньше двух экспертов');
    expect(kendallVerdict(null)).toContain('двух экспертов');
  });
});
