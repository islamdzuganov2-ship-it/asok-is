/**
 * sliceTypes.ts — сквозной разрез (Slice), ТЗ v21 §3.1.
 *
 * Один объект «о чём сейчас разговор» — общий формат фильтра, который принимают
 * `CockpitTile.useValue`/`Detail`. Источник истины — адресная строка (sliceUrl.ts).
 */
export type Criticality = 'MC' | 'BC' | 'BO';

export const CRITICALITY_TO_CLASS: Record<Criticality, string> = {
  MC: 'MISSION CRITICAL',
  BC: 'BUSINESS CRITICAL',
  BO: 'BUSINESS OPERATIONAL',
};

/**
 * Денежная линза (ТЗ-21 §3.1): в чём показывать величину на экранах, где это переключаемо —
 * балл качества / ALE под риском / ΔALE, снимаемый мерами / покрытие мерами. Поднята из
 * локального состояния теплокарты управленческого дашборда (`MoneyMode`) в общий разрез.
 */
export type Lens = 'score' | 'ale' | 'delta' | 'coverage';
export const LENSES: readonly Lens[] = ['score', 'ale', 'delta', 'coverage'];
export const LENS_LABELS: Record<Lens, string> = {
  score: 'Балл качества',
  ale: 'ALE под риском, ₽',
  delta: 'ΔALE мерами, ₽',
  coverage: 'Покрытие мерами, %',
};
export const isLens = (v: unknown): v is Lens => typeof v === 'string' && (LENSES as readonly string[]).includes(v);

export interface Slice {
  /** Код периода или 'latest' — последний доступный. */
  period: string;
  /** id ИС; [] — весь портфель. */
  systems: string[];
  /** Классы критичности; [] — все. */
  criticality: Criticality[];
  /** Характеристика ISO 25010 (полное название), null — все. */
  characteristic: string | null;
  /** Подхарактеристика, null — все. */
  subcharacteristic: string | null;
  /** Владелец ИС / ответственный за меру, null — все. */
  owner: string | null;
  /**
   * Денежная линза (§3.1). Не задана — действует линза роли по умолчанию (`score` для CTO,
   * `ale` для CEO, см. lensOf). Это способ ПОКАЗА, а не фильтр: в счётчик фильтров и в
   * признак «разрез пуст» не входит.
   */
  lens?: Lens;
}

/** Действующая линза: явно выбранная в разрезе, иначе дефолт экрана. */
export function lensOf(s: Slice, fallback: Lens): Lens {
  return s.lens ?? fallback;
}

export const DEFAULT_SLICE: Slice = {
  period: 'latest',
  systems: [],
  criticality: [],
  characteristic: null,
  subcharacteristic: null,
  owner: null,
};

/** Разрез не сужен — показанная цифра относится ко всему портфелю. */
export function isSliceEmpty(s: Slice): boolean {
  return s.period === 'latest' && s.systems.length === 0 && s.criticality.length === 0
    && !s.characteristic && !s.subcharacteristic && !s.owner;
}

/** Число активных фильтров — для чипа «Разрез (N)» на свёрнутой панели (ТЗ v21 §3.4). */
export function activeFilterCount(s: Slice): number {
  let n = 0;
  if (s.period !== 'latest') n += 1;
  if (s.systems.length) n += 1;
  if (s.criticality.length) n += 1;
  if (s.characteristic) n += 1;
  if (s.subcharacteristic) n += 1;
  if (s.owner) n += 1;
  return n;
}
