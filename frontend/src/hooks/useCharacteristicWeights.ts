/**
 * useCharacteristicWeights.ts — веса характеристик ГОСТ 25010 на уровне характеристики (не
 * подхарактеристики), для карточек, взвешивающих проблемные ИС/эффективность/динамику (ТЗ v20).
 *
 * Источник — GET /quality/weights (открыт всем аутентифицированным, quality/router.py:105),
 * отдаёт веса ПОДхарактеристик; здесь они суммируются по characteristic — тот же принцип, что и
 * серверный CHARACTERISTIC_WEIGHTS (quality/weights.py:61-63), без дублирования бэкенд-кода.
 */
import { useMemo } from 'react';
import { useGetQualityWeightsQuery } from '../store/api/apiSlice';

export function useCharacteristicWeights(): { weights: Record<string, number>; isLoading: boolean } {
  const { data, isLoading } = useGetQualityWeightsQuery();

  const weights = useMemo(() => {
    const out: Record<string, number> = {};
    (data?.subcharWeights ?? []).forEach((row) => {
      out[row.characteristic] = (out[row.characteristic] ?? 0) + row.weight;
    });
    return out;
  }, [data]);

  return { weights, isLoading };
}
