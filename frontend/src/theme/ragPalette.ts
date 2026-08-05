/**
 * ragPalette.ts — единая «спокойная» RAG-палитра для C-Level интерфейсов.
 * Требование ТЗ v9 (P5/O3): не кричащие тона, usability для топ-менеджмента.
 * Используется обоими дашбордами и модальными окнами.
 */

import type { CSSProperties } from 'react';

export type RagKey = 'good' | 'medium' | 'bad' | 'muted';

export interface RagToken {
  /**
   * ГРАФИКА: сектора диаграмм, маркеры, шкалы, точки-акценты.
   * Держим ≥3:1 с белым (WCAG 2.1, 1.4.11 «Non-text Contrast»).
   * НЕ использовать для текста и не подкладывать под белый текст — для этого `strong`.
   */
  color: string;
  /**
   * ТЕКСТ и ПЛАШКИ: цвет текста на белом/`soft`-фоне и фон плашки под белым текстом.
   * Держим ≥4.5:1 и с белым, и с собственным `soft` (WCAG 2.1, 1.4.3 «Contrast (Minimum)»).
   */
  strong: string;
  /** Светлая заливка для фона карточек/строк */
  soft: string;
  /** Цвет рамки */
  border: string;
  /** Словесная подпись уровня */
  label: string;
}

/**
 * Приглушённая палитра: шалфейный / тёплое золото / терракот / графит.
 *
 * Контраст (T-57): пара `color`/`strong` разделена намеренно — приглушённый тон читается
 * как «дорогой» на графиках, но как текст он не проходил AA (золото давало 2.42:1).
 * Числа проверяются `npm run check:contrast` (frontend/scripts/check-contrast.mjs).
 */
export const RAG: Record<RagKey, RagToken> = {
  good:   { color: '#6F9F86', strong: '#47785E', soft: '#ECF3EF', border: '#CADDD3', label: 'Высокий' },
  medium: { color: '#B88E32', strong: '#886822', soft: '#F7F1E2', border: '#E7DABB', label: 'Средний' },
  bad:    { color: '#C06B5A', strong: '#AE4C39', soft: '#F6EAE6', border: '#E6CCC4', label: 'Низкий'  },
  muted:  { color: '#8C96A0', strong: '#62707D', soft: '#F1F2F3', border: '#DEE0E3', label: 'Не измерено' },
};

/**
 * Базовые «спокойные» цвета бренда.
 * `inkSoft` — рабочий тон вторичного текста: 5.83:1 на белом и 5.29:1 на полотне-градиенте,
 * в отличие от дефолтного antd `rgba(0,0,0,.45)` (3.05:1 на полотне — ниже AA).
 *
 * ТЗ v17 (темизация): значения переведены на CSS-переменные — их проставляет ThemeVarsBridge по
 * выбранной теме (theme/themes.ts). Дефолты переменных = премиум-тема (styles/themes.css), поэтому
 * при отсутствии bridge вид не меняется. ВНИМАНИЕ: эти токены — для DOM-инлайна; в ECharts (canvas)
 * var() не работает — там берите useChartTokens() (theme/useThemeTokens.ts).
 */
export const BRAND = {
  ink:       'var(--ink)',       // основной текст (тёмный на свету / мягкий светлый в graphite)
  inkSoft:   'var(--ink-soft)',
  surface:   'var(--surface)',
  canvas:    'var(--canvas)',
  divider:   'var(--divider)',
};

/**
 * Порог → ключ RAG. Совпадает с бэкенд-логикой уровней (>=81 / 41–80 / <41).
 * Возвращает ключ палитры для процентного балла 0..100.
 */
export function ragByScore(score: number): RagKey {
  if (score < 0) return 'muted';
  if (score >= 81) return 'good';
  if (score >= 41) return 'medium';
  return 'bad';
}

/** Словесный уровень качества по баллу (6 градаций методики МК_8.1). */
export function levelLabel(score: number): string {
  if (score < 0) return 'Невозможно измерить';
  if (score >= 81) return 'Высокий уровень';
  if (score >= 61) return 'Выше среднего';
  if (score >= 41) return 'Средний уровень';
  if (score >= 21) return 'Ниже среднего';
  return 'Низкий уровень';
}

/** Готовый токен RAG по баллу. */
export const ragToken = (score: number): RagToken => RAG[ragByScore(score)];

/**
 * Плашка «сплошной тон + белый текст». Принимает ТОЛЬКО глубокий тон (`strong` или
 * `LEVEL_TAG_COLORS`), иначе белый текст не проходит AA — ради этого и заведён хелпер:
 * инвариант «белый текст только на глубоком тоне» виден в месте вызова.
 */
export const solidTagStyle = (strong: string): CSSProperties => ({
  background: strong,
  color: '#FFFFFF',
  border: 'none',
});

/** Пастельные стили тега критичности ИС (без ярких красных/оранжевых). */
const CRIT: Record<string, { bg: string; fg: string }> = {
  'MISSION CRITICAL':     { bg: '#F3DAD5', fg: '#8E4537' }, // мягкий терракот
  'BUSINESS CRITICAL':    { bg: '#F4E8CC', fg: '#806121' }, // мягкое золото
  'BUSINESS OPERATIONAL': { bg: '#E7EAEE', fg: '#5B6675' }, // нейтральный графит
};

export const critTagStyle = (criticality: string): CSSProperties => {
  const t = CRIT[criticality] ?? CRIT['BUSINESS OPERATIONAL'];
  return { background: t.bg, color: t.fg, border: 'none' };
};
