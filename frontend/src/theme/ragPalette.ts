/**
 * ragPalette.ts — единая «спокойная» RAG-палитра для C-Level интерфейсов.
 * Требование ТЗ v9 (P5/O3): не кричащие тона, usability для топ-менеджмента.
 * Используется обоими дашбордами и модальными окнами.
 */

import type { CSSProperties } from 'react';

export type RagKey = 'good' | 'medium' | 'bad' | 'muted';

export interface RagToken {
  /** Насыщенный (но приглушённый) цвет маркера/текста */
  color: string;
  /** Светлая заливка для фона карточек/строк */
  soft: string;
  /** Цвет рамки */
  border: string;
  /** Словесная подпись уровня */
  label: string;
}

/** Приглушённая палитра: шалфейный / тёплое золото / терракот / графит. */
export const RAG: Record<RagKey, RagToken> = {
  good:   { color: '#6F9F86', soft: '#ECF3EF', border: '#CADDD3', label: 'Высокий' },
  medium: { color: '#C9A14A', soft: '#F7F1E2', border: '#E7DABB', label: 'Средний' },
  bad:    { color: '#C06B5A', soft: '#F6EAE6', border: '#E6CCC4', label: 'Низкий'  },
  muted:  { color: '#9AA0A6', soft: '#F1F2F3', border: '#DEE0E3', label: 'Не измерено' },
};

/** Базовые «спокойные» цвета бренда. */
export const BRAND = {
  ink:       '#2B3A4B', // основной тёмно-синий графит
  inkSoft:   '#5B6675',
  surface:   '#FFFFFF',
  canvas:    '#F5F6F8',
  divider:   '#E8EAED',
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
  if (score >= 61) return 'Уровень выше среднего';
  if (score >= 41) return 'Средний уровень';
  if (score >= 21) return 'Уровень ниже среднего';
  return 'Низкий уровень';
}

/** Готовый токен RAG по баллу. */
export const ragToken = (score: number): RagToken => RAG[ragByScore(score)];

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
