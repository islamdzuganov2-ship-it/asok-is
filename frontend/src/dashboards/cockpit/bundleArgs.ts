/**
 * bundleArgs.ts — единая сборка аргументов `getCockpitBundle` (ТЗ v21 §10.5).
 *
 * ВАЖНО: и плитки (ceoTiles/ctoTiles), и страница дашборда (для AI-резюме `CockpitInsight`)
 * обязаны звать `useGetCockpitBundleQuery` с ОДИНАКОВО сериализованными аргументами — RTK Query дедуплицирует
 * запросы по сериализации аргументов, поэтому малейшее расхождение (другой порядок ключей
 * значения не имеет, но другое значение — да) превращает один сетевой запрос обратно в два.
 */
import type { Slice } from '../../store/slice/sliceTypes';
import { CRITICALITY_TO_CLASS } from '../../store/slice/sliceTypes';
import type { CockpitBundleArgs } from './apiTypes';

export function cockpitBundleArgs(role: 'CEO' | 'CTO', slice: Slice): CockpitBundleArgs {
  return {
    role,
    systemId: slice.systems.length ? slice.systems.join(',') : undefined,
    criticality: slice.criticality.length ? slice.criticality.map((c) => CRITICALITY_TO_CLASS[c]).join(',') : undefined,
    characteristic: slice.characteristic ?? undefined,
  };
}
