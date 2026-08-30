/**
 * types.ts — контракт плитки кокпита (ТЗ v21 §7.1).
 *
 * Один и тот же контракт (Р-3: разные по содержанию, одинаковые по механике) оборачивается в
 * `CardDef` конструктора дашбордов (см. dashboards/cards/cockpitCards.tsx) и для CEO, и для
 * CTO — обёртка не знает, что внутри `useValue`/`Detail` конкретной плитки.
 */
import type React from 'react';
import type { Slice } from '../../store/slice/sliceTypes';

export type Tone = 'critical' | 'low' | 'medium' | 'high' | 'neutral';

export interface TileEmpty {
  reason: string;
  fixHref?: string;
  fixLabel?: string;
}

export interface TileDelta {
  value: number;
  unit: string;
  direction: 'up' | 'down';
}

/**
 * Значение плитки. §7.3 «честная пустота»: value=null ⇒ empty ОБЯЗАТЕЛЕН — плитка не имеет
 * права показать 0/«—» без причины.
 */
export interface TileValue {
  value: number | string | null;
  unit?: '₽/год' | '%' | 'шт.' | 'п.п.' | null;
  delta?: TileDelta;
  trend?: number[];
  tone: Tone;
  subtitle: string;
  empty?: TileEmpty;
  loading?: boolean;
}

/**
 * Пояснение «как посчитано» на подсказке к плитке — минималистичное, условное: не формула
 * в математической нотации, а простыми словами что прибавляет к цифре (кредит) и что её
 * уменьшает (дебет). Разложение необязательно: там, где цифра не является разностью двух
 * потоков (например, счётчик решений в очереди), задаём только `summary`.
 */
export interface TileFormula {
  summary: string;
  credit?: string[];
  debit?: string[];
}

export interface TileRow {
  key: string;
  label: string;
  value: string;
  tone?: Tone;
  /** Ссылка L3 (уже с уточнённым разрезом) — переход на существующую глубокую страницу. */
  href?: string;
}

export interface CockpitTile {
  id: string;
  question: string;
  /** Право, определяющее видимость плитки; без него плитка не рендерится и не запрашивает данные. */
  perm?: string;
  defaultEnabled: boolean;
  /** Подсказка «как посчитано» — статическая методология, не зависит от разреза/значения. */
  formula: TileFormula;
  useValue(slice: Slice): TileValue;
  /** Содержимое шторки L2 — таблица разложения + ссылка на L3. */
  Detail: React.FC<{ slice: Slice }>;
}
