/**
 * check-size.mjs — потолок размера модулей (ДЕФ-39).
 *
 * Ревью зафиксировало компоненты по 30–43 КБ: один файл — это несколько экранов, таблиц и
 * модалок сразу. Разово декомпозировать их — отдельная задача со своим регрессом; здесь
 * закрыта та часть дефекта, которая позволяла долгу расти дальше.
 *
 * Правило: файл из списка не может стать больше, чем сейчас; новый файл не может сразу
 * родиться крупнее общего потолка. При декомпозиции число в списке уменьшают — вторая
 * проверка этого требует, иначе бюджет превратился бы в вечное разрешение.
 *
 * Почему отдельный скрипт, а не vitest: в проекте нет @types/node, поэтому файл с
 * импортами node:fs не проходил бы `tsc`. Инварианты такого рода в проекте уже живут
 * в scripts/*.mjs (check-contrast, check-ui) — держим там же.
 *
 * Запуск: npm run check:size   (ненулевой код возврата = есть нарушения)
 */
import { globSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = resolve(fileURLToPath(new URL('../src/', import.meta.url)));

/** Общий потолок для НОВЫХ файлов, КБ. */
const DEFAULT_LIMIT_KB = 20;

/** Долг на 2026-08-15: фактический размер, КБ. Уменьшать при декомпозиции.
 *
 *  2026-08-26 (БТ-500): долг разобран полностью — нарушений потолка не осталось.
 *   • страницы дашбордов стали обёртками над конструктором (1–2 КБ) и из бюджета убраны;
 *   • RiskEconomicsPage разобрана на вкладки-модули: 86 → 5 КБ, тоже убрана из бюджета;
 *   • governanceSlice отдал контракт в governanceTypes: 27 → 18 КБ, убран из бюджета;
 *   • у остальных бюджет опущен до фактического размера — расти им больше некуда.
 *  Оставшиеся строки — не разрешение, а верхняя граница: файл из списка не может стать больше. */
const SIZE_BUDGET_KB = {
  'pages/NewAssessmentPage.tsx': 35,
  'data/mockScaleData.ts': 33,
  'pages/AiAssessmentPage.tsx': 31,
  'store/api/apiSlice.ts': 31,
  'pages/ExcelReportsPage.tsx': 29,
};

const sources = globSync('**/*.{ts,tsx}', { cwd: SRC })
  .map((p) => p.replace(/\\/g, '/'))
  .filter((p) => !p.includes('__tests__'));

const sizeKb = (rel) => Math.round(statSync(resolve(SRC, rel)).size / 1024);

let failed = 0;

for (const rel of sources) {
  const kb = sizeKb(rel);
  const limit = SIZE_BUDGET_KB[rel] ?? DEFAULT_LIMIT_KB;
  if (kb > limit) {
    failed += 1;
    console.log(`ПРЕВЫШЕН  ${rel.padEnd(46)} ${kb} КБ при потолке ${limit} КБ`);
  }
}

for (const [rel, budget] of Object.entries(SIZE_BUDGET_KB)) {
  let kb;
  try {
    kb = sizeKb(rel);
  } catch {
    failed += 1;
    console.log(`УСТАРЕЛ   ${rel.padEnd(46)} файла нет — уберите из бюджета`);
    continue;
  }
  if (kb < budget - 1) {
    failed += 1;
    console.log(`ЗАВЫШЕН   ${rel.padEnd(46)} фактически ${kb} КБ при бюджете ${budget} КБ`);
  }
}

console.log(`\nФайлов проверено: ${sources.length}, нарушений: ${failed}`);
if (failed > 0) {
  console.error('\nВынесите часть модуля в отдельный файл, а не поднимайте потолок.');
  process.exit(1);
}
console.log('Потолок размера модулей соблюдён.');
