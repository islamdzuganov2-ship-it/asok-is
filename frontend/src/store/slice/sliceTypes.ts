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
