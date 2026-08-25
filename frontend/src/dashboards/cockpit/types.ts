/**
 * types.ts — контракт плитки кокпита (ТЗ v21 §7.1).
 *
 * Реестр плиток строит один и тот же `ExecCockpit` для CEO и CTO (Р-3: разные по содержанию,
 * одинаковые по механике) — оболочка не знает, что внутри `useValue`/`Detail` конкретной плитки.
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
  useValue(slice: Slice): TileValue;
  /** Содержимое шторки L2 — таблица разложения + ссылка на L3. */
  Detail: React.FC<{ slice: Slice }>;
}
