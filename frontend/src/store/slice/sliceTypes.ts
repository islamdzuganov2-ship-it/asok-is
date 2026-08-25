/**
 * sliceTypes.ts — сквозной разрез (Slice), ТЗ v21 §3.1.
 *
 * Один объект «о чём сейчас разговор», общий для кокпитов и (позже) остальных экранов.
 * Живёт в адресной строке (см. sliceUrl.ts) — Redux не используется как источник истины,
 * чтобы ссылка на экран оставалась воспроизводимой без скрытого состояния стора.
 */
export type Criticality = 'MC' | 'BC' | 'BO';

export const CRITICALITY_TO_CLASS: Record<Criticality, string> = {
  MC: 'MISSION CRITICAL',
  BC: 'BUSINESS CRITICAL',
  BO: 'BUSINESS OPERATIONAL',
};

export type MoneyLens = 'score' | 'ale' | 'delta' | 'coverage';

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
  /** Денежная линза — по умолчанию задаётся кокпитом роли (CEO → 'ale', CTO → 'score'). */
  lens: MoneyLens;
}

export const DEFAULT_SLICE: Slice = {
  period: 'latest',
  systems: [],
  criticality: [],
  characteristic: null,
  subcharacteristic: null,
  owner: null,
  lens: 'score',
};

export function isSliceEmpty(s: Slice): boolean {
  return s.period === 'latest' && s.systems.length === 0 && s.criticality.length === 0
    && !s.characteristic && !s.subcharacteristic && !s.owner;
}

/** Число активных фильтров — для чипа «Разрез (N)» на узком экране. */
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
