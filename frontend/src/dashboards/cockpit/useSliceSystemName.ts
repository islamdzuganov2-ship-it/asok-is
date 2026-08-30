/**
 * useSliceSystemName.ts — резолвинг id → имя системы для эндпоинтов, которые фильтруют по
 * ИМЕНИ, а не id (`/risks/triggered`, `/incidents/analytics`, `RiskRadarPage`, `IncidentsAnalyticsPage`
 * — устоявшийся контракт этих экранов, см. ТЗ v21 §17 границ). Slice.systems везде хранит id.
 */
import { useGetSystemsQuery } from '../../store/api/apiSlice';
import type { Slice } from '../../store/slice/sliceTypes';

export function useSingleSystemName(slice: Slice): string | undefined {
  const { data } = useGetSystemsQuery();
  if (slice.systems.length !== 1) return undefined;
  return data?.items.find((s) => s.id === slice.systems[0])?.name;
}
