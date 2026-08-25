/**
 * sliceUrl.ts — сериализация разреза в адресную строку и обратно (ТЗ v21 §3.2).
 *
 * Адресная строка — источник истины. `useSlice()` — ЕДИНСТВЕННЫЙ разрешённый способ читать
 * и менять разрез в новых компонентах кокпита (регресс-тест sliceUrl.test.ts проверяет только
 * сам контракт сериализации; дисциплина «не читать ключи напрямую» соблюдается по коду).
 *
 * Обратная совместимость (§3.3): старые страницы уже используют свои ключи (`characteristic`,
 * `system`, `owner`). paramsToSlice понимает их как синонимы новых (`char`, `sys`), поэтому
 * старые ссылки продолжают открывать то же самое — компонент решает сам, писать ли назад
 * в новом формате (см. useSlice ниже — пишет только через новые ключи).
 */
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CRITICALITY_TO_CLASS, Criticality, DEFAULT_SLICE, MoneyLens, Slice } from './sliceTypes';

const CRIT_KEYS = new Set<string>(['MC', 'BC', 'BO']);
const LENS_KEYS = new Set<string>(['score', 'ale', 'delta', 'coverage']);

export function sliceToParams(s: Slice, base?: URLSearchParams): URLSearchParams {
  const p = new URLSearchParams(base);
  if (s.period && s.period !== 'latest') p.set('p', s.period); else p.delete('p');
  if (s.systems.length) p.set('sys', s.systems.join(',')); else p.delete('sys');
  if (s.criticality.length) p.set('crit', s.criticality.join(',')); else p.delete('crit');
  if (s.characteristic) p.set('char', s.characteristic); else p.delete('char');
  if (s.subcharacteristic) p.set('sub', s.subcharacteristic); else p.delete('sub');
  if (s.owner) p.set('owner', s.owner); else p.delete('owner');
  if (s.lens && s.lens !== 'score') p.set('lens', s.lens); else p.delete('lens');
  return p;
}

export function paramsToSlice(p: URLSearchParams, defaults: Partial<Slice> = {}): Slice {
  const period = p.get('p') ?? defaults.period ?? DEFAULT_SLICE.period;
  const sysRaw = p.get('sys') ?? p.get('system'); // 'system' — старый ключ (IncidentsAnalyticsPage — имя, не id)
  const systems = sysRaw ? sysRaw.split(',').filter(Boolean) : (defaults.systems ?? DEFAULT_SLICE.systems);
  const critRaw = p.get('crit');
  const criticality = critRaw
    ? (critRaw.split(',').filter((c) => CRIT_KEYS.has(c)) as Criticality[])
    : (defaults.criticality ?? DEFAULT_SLICE.criticality);
  const characteristic = p.get('char') ?? p.get('characteristic') ?? defaults.characteristic ?? null;
  const subcharacteristic = p.get('sub') ?? defaults.subcharacteristic ?? null;
  const owner = p.get('owner') ?? defaults.owner ?? null;
  const lensRaw = p.get('lens');
  const lens = (lensRaw && LENS_KEYS.has(lensRaw) ? lensRaw : defaults.lens ?? DEFAULT_SLICE.lens) as MoneyLens;
  return { period, systems, criticality, characteristic, subcharacteristic, owner, lens };
}

export function criticalityClasses(s: Slice): string[] {
  return s.criticality.map((c) => CRITICALITY_TO_CLASS[c]);
}

/**
 * useSlice — читает разрез из текущего URL и даёт функцию частичного обновления.
 * `defaults.lens` задаёт линзу по умолчанию для кокпита роли (CEO → 'ale', CTO → 'score'),
 * пока пользователь не переключил её явно (тогда она уже есть в URL и defaults не действует).
 */
export function useSlice(defaults?: Partial<Slice>): [Slice, (patch: Partial<Slice>) => void, () => void] {
  const [params, setParams] = useSearchParams();
  const slice = useMemo(() => paramsToSlice(params, defaults), [params, defaults]);

  const patch = useCallback((p: Partial<Slice>) => {
    setParams((prev) => sliceToParams({ ...paramsToSlice(prev, defaults), ...p }, prev), { replace: false });
  }, [setParams, defaults]);

  const reset = useCallback(() => {
    setParams((prev) => sliceToParams(DEFAULT_SLICE, prev));
  }, [setParams]);

  return [slice, patch, reset];
}

/** Строка-резюме для свёрнутой панели разреза («Весь портфель · 2026-Q2 · все классы»). */
export function sliceSummaryText(s: Slice): string {
  const parts: string[] = [];
  parts.push(s.systems.length ? `${s.systems.length} ИС` : 'Весь портфель');
  parts.push(s.period === 'latest' ? 'последний период' : s.period);
  parts.push(s.criticality.length ? s.criticality.join('/') : 'все классы');
  if (s.characteristic) parts.push(s.characteristic);
  if (s.owner) parts.push(s.owner);
  return parts.join(' · ');
}
