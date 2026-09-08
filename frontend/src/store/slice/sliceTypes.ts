/**
 * sliceTypes.ts — сквозной разрез (Slice), ТЗ v21 §3.1.
 *
 * Один объект «о чём сейчас разговор» — общий формат фильтра, который принимают
 * `CockpitTile.useValue`/`Detail`. Пока карточки кокпита работают на `DEFAULT_SLICE`
 * (весь портфель, см. CockpitScope) — полоса фильтра периода/ИС/критичности с синхронизацией
 * в URL (sliceUrl.ts из ТЗ v21) в этот заход не переносилась, задача отдельная.
 */
export type Criticality = 'MC' | 'BC' | 'BO';

export const CRITICALITY_TO_CLASS: Record<Criticality, string> = {
  MC: 'MISSION CRITICAL',
  BC: 'BUSINESS CRITICAL',
  BO: 'BUSINESS OPERATIONAL',
};

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
