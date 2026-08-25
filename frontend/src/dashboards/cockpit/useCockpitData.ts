/**
 * useCockpitData.ts — обёртка над apiGet для плиток кокпита: загрузка/ошибка/данные, без
 * стороннего клиента запросов (тот же паттерн raw-fetch, что уже используют ExecutiveDashboard
 * и RiskEconomicsPage — не вводим второй способ ходить за данными ради шести плиток).
 */
import { useEffect, useState } from 'react';
import { apiGet } from '../../utils/apiFetch';

export interface CockpitFetchState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

export function useCockpitFetch<T>(path: string | null): CockpitFetchState<T> {
  const [state, setState] = useState<CockpitFetchState<T>>({ data: null, loading: !!path, error: null });

  useEffect(() => {
    if (!path) { setState({ data: null, loading: false, error: null }); return; }
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    apiGet<T>(path)
      .then((d) => { if (alive) setState({ data: d, loading: false, error: null }); })
      .catch((e) => { if (alive) setState({ data: null, loading: false, error: e.message || 'Ошибка запроса' }); });
    return () => { alive = false; };
  }, [path]);

  return state;
}
