/**
 * sliceUrl.ts — сериализация сквозного разреза в адресную строку и обратно (ТЗ v21 §3.2, КП-01, КП-02, КП-03, КП-04, КП-05, КП-06).
 *
 * Адресная строка — источник истины, а не Redux: ссылка на экран должна открывать ровно тот же
 * разрез у другого человека, без скрытого состояния стора. `useSlice()` — единственный
 * разрешённый способ читать и менять разрез в карточках кокпита.
 *
 * Обратная совместимость (§3.3): старые страницы уже носят свои ключи (`characteristic`,
 * `system`, `owner`). `paramsToSlice` понимает их как синонимы новых (`char`, `sys`), поэтому
 * ранее разосланные ссылки продолжают открывать то же самое; записываем всегда в новом формате.
 *
 * Денежная линза `lens` (§3.1) — ключ `lens=score|ale|delta|coverage`. Читают её теплокарта
 * управленческого дашборда (бывший локальный `MoneyMode`) и шторка «Где мы уязвимы?»; выбор —
 * в панели разреза. Невалидное значение из адреса отбрасывается, а не протаскивается дальше.
 */
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CRITICALITY_TO_CLASS, DEFAULT_SLICE, isLens, type Criticality, type Slice } from './sliceTypes';

const CRIT_KEYS = new Set<string>(['MC', 'BC', 'BO']);

export function sliceToParams(s: Slice, base?: URLSearchParams): URLSearchParams {
  const p = new URLSearchParams(base);
  if (s.period && s.period !== 'latest') p.set('p', s.period); else p.delete('p');
  if (s.systems.length) p.set('sys', s.systems.join(',')); else p.delete('sys');
  if (s.criticality.length) p.set('crit', s.criticality.join(',')); else p.delete('crit');
  if (s.characteristic) p.set('char', s.characteristic); else p.delete('char');
  if (s.subcharacteristic) p.set('sub', s.subcharacteristic); else p.delete('sub');
  if (s.owner) p.set('owner', s.owner); else p.delete('owner');
  if (s.lens) p.set('lens', s.lens); else p.delete('lens');
  // Старые синонимы не пишем, но и не оставляем висеть: иначе ссылка несла бы два ключа
  // с расходящимися значениями и следующий читатель получил бы не тот разрез.
  p.delete('system');
  p.delete('characteristic');
  return p;
}

export function paramsToSlice(p: URLSearchParams, defaults: Partial<Slice> = {}): Slice {
  const period = p.get('p') ?? defaults.period ?? DEFAULT_SLICE.period;
  // 'system' — старый ключ IncidentsAnalyticsPage/RiskRadarPage (там это ИМЯ системы, не id).
  const sysRaw = p.get('sys') ?? p.get('system');
  const systems = sysRaw ? sysRaw.split(',').filter(Boolean) : (defaults.systems ?? DEFAULT_SLICE.systems);
  const critRaw = p.get('crit');
  const criticality = critRaw
    ? (critRaw.split(',').filter((c) => CRIT_KEYS.has(c)) as Criticality[])
    : (defaults.criticality ?? DEFAULT_SLICE.criticality);
  const characteristic = p.get('char') ?? p.get('characteristic') ?? defaults.characteristic ?? null;
  const subcharacteristic = p.get('sub') ?? defaults.subcharacteristic ?? null;
  const owner = p.get('owner') ?? defaults.owner ?? null;
  const lensRaw = p.get('lens');
  const lens = isLens(lensRaw) ? lensRaw : defaults.lens;
  return { period, systems, criticality, characteristic, subcharacteristic, owner, ...(lens ? { lens } : {}) };
}

/** Классы критичности в том виде, в каком их ждёт бэкенд (`MISSION CRITICAL` и т.д.). */
export function criticalityClasses(s: Slice): string[] {
  return s.criticality.map((c) => CRITICALITY_TO_CLASS[c]);
}

/**
 * useSlice — читает разрез из текущего URL и даёт частичное обновление и сброс.
 *
 * `patch` пишет через функциональную форму `setParams`, а не по захваченному значению:
 * два контрола, изменённые подряд в одном кадре, иначе затирали бы друг друга.
 */
export function useSlice(defaults?: Partial<Slice>): [Slice, (patch: Partial<Slice>) => void, () => void] {
  const [params, setParams] = useSearchParams();
  // defaults приходит объектным литералом из вызова — сравниваем по содержимому, иначе
  // useMemo/useCallback пересоздавались бы на каждый рендер и тянули за собой перерисовку сетки.
  const defaultsKey = JSON.stringify(defaults ?? {});
  const slice = useMemo(
    () => paramsToSlice(params, defaults),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [params, defaultsKey],
  );

  const patch = useCallback((patchValue: Partial<Slice>) => {
    setParams((prev) => sliceToParams({ ...paramsToSlice(prev, defaults), ...patchValue }, prev));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setParams, defaultsKey]);

  // «Сбросить» обнуляет фильтры, но не линзу: линза — способ показа, а не сужение данных.
  const reset = useCallback(() => {
    setParams((prev) => {
      const lens = paramsToSlice(prev).lens;
      return sliceToParams({ ...DEFAULT_SLICE, ...(lens ? { lens } : {}) }, prev);
    });
  }, [setParams]);

  return [slice, patch, reset];
}

/** Строка-резюме для свёрнутой панели («Весь портфель · последний период · все классы»). */
export function sliceSummaryText(s: Slice): string {
  const parts: string[] = [];
  parts.push(s.systems.length ? `${s.systems.length} ИС` : 'Весь портфель');
  parts.push(s.period === 'latest' ? 'последний период' : s.period);
  parts.push(s.criticality.length ? s.criticality.join('/') : 'все классы');
  if (s.characteristic) parts.push(s.characteristic);
  if (s.owner) parts.push(s.owner);
  return parts.join(' · ');
}
