/**
 * check-contrast.mjs — проверка палитры на соответствие WCAG 2.1 (T-57).
 *
 * Зачем скрипт, а не глазами: приглушённые «премиальные» тона выглядят аккуратно, но
 * систематически не добирают контраст (золото #C9A14A как текст давало 2.42:1 при норме 4.5).
 * Проверяем каждую пару «текст ↔ фон», которая реально встречается в интерфейсе.
 *
 * Запуск: npm run check:contrast   (ненулевой код возврата = есть нарушения)
 *
 * Пороги WCAG 2.1:
 *   1.4.3 Contrast (Minimum), AA — обычный текст ≥4.5:1, крупный (≥18.66px bold / ≥24px) ≥3:1
 *   1.4.11 Non-text Contrast, AA — графика и границы элементов управления ≥3:1
 */

const AA_TEXT = 4.5;
const AA_LARGE = 3.0;
const AA_GRAPHIC = 3.0;

const hex2rgb = (h) => {
  const s = h.replace('#', '');
  const full = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
};

const relLuminance = (rgb) => {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (a, b) => {
  const [hi, lo] = [relLuminance(hex2rgb(a)), relLuminance(hex2rgb(b))].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** Полупрозрачный текст: считаем по фактическому композиту поверх фона, а не по своему цвету. */
const composite = (fgHex, alpha, bgHex) => {
  const [fg, bg] = [hex2rgb(fgHex), hex2rgb(bgHex)];
  const mix = fg.map((c, i) => Math.round(alpha * c + (1 - alpha) * bg[i]));
  return '#' + mix.map((v) => v.toString(16).padStart(2, '0')).join('');
};

// --- палитра (держать синхронной с src/theme/ragPalette.ts и LevelHeatmap.tsx) ---
const WHITE = '#FFFFFF';
const INK = '#2B3A4B';
const INK_SOFT = '#5B6675';
const CANVAS = '#F2F4F7'; // нижняя точка градиента-полотна — самый тёмный фон страницы

const RAG = {
  good:   { color: '#6F9F86', strong: '#47785E', soft: '#ECF3EF' },
  medium: { color: '#B88E32', strong: '#886822', soft: '#F7F1E2' },
  bad:    { color: '#C06B5A', strong: '#AE4C39', soft: '#F6EAE6' },
  muted:  { color: '#8C96A0', strong: '#62707D', soft: '#F1F2F3' },
};

const LEVEL_COLORS = {
  'Высокий уровень': '#86B093',
  'Выше среднего': '#A6C29A',
  'Средний уровень': '#D8BE7E',
  'Ниже среднего': '#D9A47E',
  'Низкий уровень': '#D0938A',
  'Невозможно измерить': '#AAB0B6',
};

const LEVEL_TAG_COLORS = {
  'Высокий уровень': '#4C805C',
  'Выше среднего': '#578144',
  'Средний уровень': '#917125',
  'Ниже среднего': '#AF622B',
  'Низкий уровень': '#BE5545',
  'Невозможно измерить': '#687888',
};

const CRIT = {
  'MISSION CRITICAL':     { bg: '#F3DAD5', fg: '#8E4537' },
  'BUSINESS CRITICAL':    { bg: '#F4E8CC', fg: '#806121' },
  'BUSINESS OPERATIONAL': { bg: '#E7EAEE', fg: '#5B6675' },
};

const CATEGORY_TAG_COLOR = {
  RELEASE: '#7E57C2', INFRASTRUCTURE: '#56799F', PERFORMANCE: '#947125',
  NETWORK: '#4C8165', POWER: '#C0553F', OTHER: '#667797',
};

const SEVERITY = { critical: '#A32B1F', high: '#AE4C39', medium: '#886822', low: '#56799F' };

// Пресетные плашки antd: фон/рамка родные, цвет текста поправлен в styles/a11y-overrides.css.
// `fg` здесь — итоговое (после переопределения) значение; менять вместе с CSS.
const ANTD_TAG_PRESETS = {
  volcano: { fg: '#cc360d', bg: '#fff2e8' },
  red:     { fg: '#cf1322', bg: '#fff1f0' },
  green:   { fg: '#2f840b', bg: '#f6ffed' },
  blue:    { fg: '#0958d9', bg: '#e6f4ff' },
  gold:    { fg: '#9e6604', bg: '#fffbe6' },
  orange:  { fg: '#af5807', bg: '#fff7e6' },
  purple:  { fg: '#531dab', bg: '#f9f0ff' },
};

const KIND_BAR = {
  progress:  ['#56799F', '#47678B'],
  done:      ['#4C8165', '#3E6C54'],
  overdue:   ['#C0553F', '#A64733'],
  escalated: ['#7E57C2', '#6A45AB'],
  pending:   ['#947125', '#7C5E1E'],
};

// --- набор проверок ---
const checks = [];
const check = (what, fg, bg, min) => checks.push({ what, fg, bg, min });

// Текст RAG на белом и на собственной светлой заливке
for (const [key, t] of Object.entries(RAG)) {
  check(`RAG.${key}.strong — текст на белом`, t.strong, WHITE, AA_TEXT);
  check(`RAG.${key}.strong — текст на soft`, t.strong, t.soft, AA_TEXT);
  check(`RAG.${key}.strong — плашка под белым текстом`, WHITE, t.strong, AA_TEXT);
  check(`RAG.${key}.color — графика (сектор/маркер) на белом`, t.color, WHITE, AA_GRAPHIC);
}

// Базовый текст
check('BRAND.ink — основной текст на белом', INK, WHITE, AA_TEXT);
check('BRAND.ink — основной текст на полотне', INK, CANVAS, AA_TEXT);
check('BRAND.inkSoft — вторичный текст на белом', INK_SOFT, WHITE, AA_TEXT);
check('BRAND.inkSoft — вторичный текст на полотне', INK_SOFT, CANVAS, AA_TEXT);

// Теплокарта: тёмный текст на пастельной ячейке
for (const [level, bg] of Object.entries(LEVEL_COLORS)) {
  check(`Теплокарта «${level}» — текст ink на ячейке`, INK, bg, AA_TEXT);
}
// Плашки уровней: белый текст на глубоком тоне
for (const [level, bg] of Object.entries(LEVEL_TAG_COLORS)) {
  check(`Плашка уровня «${level}» — белый текст`, WHITE, bg, AA_TEXT);
}

// Теги критичности ИС (свой fg на своём bg)
for (const [name, t] of Object.entries(CRIT)) {
  check(`Тег критичности «${name}»`, t.fg, t.bg, AA_TEXT);
}

// Первопричины сбоев и критичность рисков — белый текст на плашке
for (const [name, bg] of Object.entries(CATEGORY_TAG_COLOR)) {
  check(`Первопричина сбоя «${name}» — белый текст`, WHITE, bg, AA_TEXT);
}
for (const [name, bg] of Object.entries(SEVERITY)) {
  check(`Критичность риска «${name}» — белый текст`, WHITE, bg, AA_TEXT);
}

// Пресетные плашки antd (после переопределения цвета текста)
for (const [name, t] of Object.entries(ANTD_TAG_PRESETS)) {
  check(`Плашка antd «${name}» — текст на своём фоне`, t.fg, t.bg, AA_TEXT);
}

// Полоса Ганта: белый текст 11px по обоим концам градиента
for (const [kind, [from, to]] of Object.entries(KIND_BAR)) {
  check(`Полоса Ганта «${kind}» — белый текст (верх градиента)`, WHITE, from, AA_TEXT);
  check(`Полоса Ганта «${kind}» — белый текст (низ градиента)`, WHITE, to, AA_TEXT);
}

// Токены темы antd, заданные явно в App.tsx (ссылки, заливки Alert, подпись прогресса)
check('Ссылка antd (colorLink) на белом', '#50749B', WHITE, AA_TEXT);
check('Ссылка antd наведение (colorLinkHover)', '#3F5F82', WHITE, AA_TEXT);
check('Alert info: описание на заливке', INK_SOFT, '#EAF0F4', AA_TEXT);
check('Alert info: заголовок на заливке', INK, '#EAF0F4', AA_TEXT);
check('Alert success: описание на заливке', INK_SOFT, '#E3EDE8', AA_TEXT);
check('Alert warning: описание на заливке', INK_SOFT, '#F5EEDF', AA_TEXT);
check('Alert error: описание на заливке', INK_SOFT, '#F2E1DD', AA_TEXT);
check('Подпись Progress success', RAG.good.strong, WHITE, AA_TEXT);

// Сайдбар: текст лежит на CSS-градиенте, поэтому берём худший (самый светлый) стоп.
// Цвета полупрозрачные — сравниваем композит, а не исходный цвет.
const SIDER_LIGHTEST = '#22384C';
const GOLD_SOFT = '#E9DCBE';
check('Сайдбар: логотип «АСОК ИС»', WHITE, SIDER_LIGHTEST, AA_TEXT);
check(
  'Сайдбар: подпись «оценка качества» (α .7)',
  composite(GOLD_SOFT, 0.7, SIDER_LIGHTEST), SIDER_LIGHTEST, AA_TEXT,
);
check(
  'Сайдбар: заголовок группы меню (α .7)',
  composite(GOLD_SOFT, 0.7, SIDER_LIGHTEST), SIDER_LIGHTEST, AA_TEXT,
);
check(
  'Сайдбар: пункт меню antd dark (α .65)',
  composite(WHITE, 0.65, SIDER_LIGHTEST), SIDER_LIGHTEST, AA_TEXT,
);

// --- прогон ---
// ─── Проверка ВСЕХ тем оформления (ДЕФ-08) ───────────────────────────────────────
//
// Раньше скрипт валидировал только светлую палитру: 74 проверки были зелёными, а в теме
// graphite выбранный пункт меню давал белый текст на rgb(124,144,170) = 3.27:1. Требования
// БТ-548 (единая читаемая типографика) и T-57 (контраст) считались закрытыми, фактически —
// нет. Читаем пресеты ИЗ ИСХОДНИКА `src/theme/themes.ts`, чтобы проверка не разъезжалась
// с реальными значениями.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const themesSrc = readFileSync(resolve(here, '../src/theme/themes.ts'), 'utf8');

/** Вырезать объявление пресета по имени константы. */
const presetBlock = (constName) => {
  const start = themesSrc.indexOf(`const ${constName}`);
  if (start < 0) throw new Error(`не найден пресет ${constName} в themes.ts`);
  const end = themesSrc.indexOf('\n};', start);
  return themesSrc.slice(start, end);
};

/** Достать значение цвета: и токен antd (colorText: '#..'), и CSS-переменную ('--ink': '#..'). */
const pick = (block, key) => {
  const escaped = key.replace(/[-]/g, '\\-');
  const re = new RegExp(`['"]?${escaped}['"]?\\s*:\\s*['"](#[0-9A-Fa-f]{3,8})['"]`);
  const m = block.match(re);
  return m ? m[1] : null;
};

const THEME_PRESETS = [
  ['premium', 'PREMIUM_PRESET'],
  ['classic', 'CLASSIC_PRESET'],
  ['graphite', 'GRAPHITE_PRESET'],
];

for (const [themeName, constName] of THEME_PRESETS) {
  const block = presetBlock(constName);
  const text = pick(block, 'colorText');
  const textSecondary = pick(block, 'colorTextSecondary');
  const container = pick(block, 'colorBgContainer');
  const layout = pick(block, 'colorBgLayout');
  const elevated = pick(block, 'colorBgElevated');
  const primary = pick(block, 'colorPrimary');
  const link = pick(block, 'colorLink');

  if (text && container) check(`[${themeName}] основной текст на карточке`, text, container, AA_TEXT);
  if (text && layout) check(`[${themeName}] основной текст на полотне`, text, layout, AA_TEXT);
  if (text && elevated) check(`[${themeName}] основной текст на всплывающем слое`, text, elevated, AA_TEXT);
  if (textSecondary && container) check(`[${themeName}] вторичный текст на карточке`, textSecondary, container, AA_TEXT);
  if (textSecondary && layout) check(`[${themeName}] вторичный текст на полотне`, textSecondary, layout, AA_TEXT);
  if (link && container) check(`[${themeName}] ссылка на карточке`, link, container, AA_TEXT);
  // Выбранный пункт меню и первичная кнопка: текст ПОВЕРХ заливки colorPrimary — та самая
  // пара, которая проваливалась в graphite (2.50:1). Цвет этого текста задаётся токеном
  // colorTextLightSolid; если тема его не переопределяет, antd рисует белым.
  const onPrimary = pick(block, 'colorTextLightSolid') || WHITE;
  if (primary) check(`[${themeName}] текст на первичном цвете (кнопка, выбранный пункт)`, onPrimary, primary, AA_TEXT);
  if (primary && container) check(`[${themeName}] первичный цвет как графика на карточке`, primary, container, AA_GRAPHIC);
}

let failed = 0;
const rows = checks.map((c) => {
  const ratio = contrast(c.fg, c.bg);
  const ok = ratio >= c.min;
  if (!ok) failed += 1;
  return { ...c, ratio, ok };
});

const width = Math.max(...rows.map((r) => r.what.length));
for (const r of rows) {
  const mark = r.ok ? 'ok  ' : 'FAIL';
  console.log(
    `${mark} ${r.what.padEnd(width)}  ${r.ratio.toFixed(2).padStart(5)}:1  (нужно ≥${r.min})`
    + `  ${r.fg} на ${r.bg}`,
  );
}

console.log(`\nПроверок: ${rows.length}, нарушений: ${failed}`);
if (failed > 0) {
  console.error('\nWCAG 2.1 AA не выполнен — поправьте палитру в src/theme/ragPalette.ts.');
  process.exit(1);
}
console.log('WCAG 2.1 AA выполнен по всем проверенным парам.');
