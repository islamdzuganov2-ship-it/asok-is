/**
 * requirementMarkers.test.ts — страж формата маркеров требований во фронте (Р-12, ревью 2026-09-07).
 *
 * Зеркало backend/tests/test_requirement_markers.py: ТЗ-23 считает покрытие grep'ом по схеме
 * `<ПРЕФИКС>-NN`, и маркер с однозначным номером (без ведущего нуля) выпадает из подсчёта молча. Коды вопросов
 * (`В-КП-1`) и коды данных (`RE-2026-001`) маркерами не считаются.
 */
import { describe, it, expect } from 'vitest';

const SCHEMES: Record<string, number> = { 'УК': 60, 'КП': 45, 'КД': 24, RE: 27 };
const MARKER = /(?<![\wА-Яа-яЁё-])(УК|КП|КД|RE)-(\d+)(?![\d-])/g;

// Исходники читаются через Vite (`?raw`), а не node:fs: во фронте нет @types/node, и тест
// видит ровно тот же набор файлов, что и сборка.
const SOURCES = import.meta.glob('../**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

function markers(): Array<{ where: string; prefix: string; num: string }> {
  const out: Array<{ where: string; prefix: string; num: string }> = [];
  for (const [file, text] of Object.entries(SOURCES)) {
    text.split('\n').forEach((line, i) => {
      for (const m of line.matchAll(MARKER)) {
        out.push({ where: `${file}:${i + 1}`, prefix: m[1], num: m[2] });
      }
    });
  }
  return out;
}

describe('маркеры требований в исходниках фронта', () => {
  const all = markers();

  it('сканер видит исходники (иначе проверки ниже прошли бы вхолостую)', () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(50);
    expect(all.length).toBeGreaterThan(10);
  });

  it('номер — ровно две цифры', () => {
    const bad = all.filter((m) => m.num.length !== 2).map((m) => `${m.where} ${m.prefix}-${m.num}`);
    expect(bad).toEqual([]);
  });

  it('номер в объявленном диапазоне схемы', () => {
    const bad = all
      .filter((m) => m.num.length === 2 && !(Number(m.num) >= 1 && Number(m.num) <= SCHEMES[m.prefix]))
      .map((m) => `${m.where} ${m.prefix}-${m.num}`);
    expect(bad).toEqual([]);
  });
});
