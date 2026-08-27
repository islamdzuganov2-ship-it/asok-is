/**
 * shared.ts — общий контракт вкладок риск-экономического контура (BL-007).
 *
 * DTO приходят с бэкенда в camelCase; расчёты (C_ТС, ALE, ROSI, покрытие) считает он же —
 * здесь только формы данных, подача и тонкий клиент. Вынесено из RiskEconomicsPage, чтобы
 * четыре рабочие вкладки жили отдельными модулями и страница осталась оболочкой с табами.
 */
const VITE_API = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api/v1';

// ─── DTO контура ───
export interface RiskEvent {
  id: string; code: string; title: string; description?: string | null; category?: string | null;
  owner?: string | null; aro?: number | null; aroIsExpert: boolean; sleExpert?: number | null;
  aleAvg?: number | null; aleP90?: number | null; maxSle?: number | null;
  riskAppetite?: number | null; regulatory: boolean; status: string;
}
export interface SupportRate {
  id: string; systemId?: string | null; line: string; executorType: string; vendor?: string | null;
  mode?: string | null; ratePerHour: number; kEvening: number; kWeekend: number; isActive: boolean;
}
export interface BusinessProcess {
  id: string; code: string; name: string; kind: string; owner?: string | null; isActive: boolean;
}
export interface BpCost { id: string; businessProcessId: string; method: string; costPerMinBase?: number | null }

/** ТЗ v19 п.9-10, В-30а: source/observedOn обязательны на бэкенде — бенчмарк без источника
 *  и даты наблюдения отклоняется валидацией, чтобы «рынок» нельзя было выдумать. */
export interface MarketBenchmark {
  id: string; kind: string; dimension: string; companySizeClass?: string | null;
  value: number; unit: string; source: string; observedOn: string; note?: string | null;
}
/** УК-24: сравнение «мы/рынок» считает бэкенд (econ/service.py), фронт только показывает. */
export interface BenchmarkComparison {
  ownValue: number | null; ownUnit: string; benchmark?: MarketBenchmark | null;
  deltaPct?: number | null; note: string;
}
export interface Nonconformity {
  id: string; code?: string | null; systemName: string; characteristic: string;
  subcharacteristic: string; level: string; status: string; owner: string;
  evaluatedAle?: number | null; evidenceType?: string | null; isBlocking: boolean;
}
export interface FunnelStage { status: string; count: number }
export interface ClosureFunnel { total: number; verified: number; closureRate: number; stages: FunnelStage[] }
export interface AleResult { incidentsCounted: number; incidentsCosted: number; aro?: number | null; aleAvg?: number | null }

// ─── Подача ───
export const fmtMoney = (v?: number | null): string =>
  v === null || v === undefined ? '—' : `${new Intl.NumberFormat('ru-RU').format(Math.round(v))} ₽`;
export const fmtNum = (v?: number | null, digits = 2): string =>
  v === null || v === undefined ? '—' : new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(v);

export const RISK_STATUS: Record<string, { label: string; color: string }> = {
  active: { label: 'Активен', color: 'blue' }, archived: { label: 'В архиве', color: 'default' },
};
export const NC_STATUS: Record<string, { label: string; color: string }> = {
  IDENTIFIED: { label: 'Выявлено', color: 'default' },
  EVALUATED: { label: 'Оценено', color: 'gold' },
  DECIDED: { label: 'Решение принято', color: 'geekblue' },
  MEASURE_ASSIGNED: { label: 'Мера назначена', color: 'cyan' },
  IN_PROGRESS: { label: 'В работе', color: 'processing' },
  EXECUTED: { label: 'Исполнено', color: 'blue' },
  VERIFIED: { label: 'Верифицировано', color: 'green' },
};
export const NC_LEVEL: Record<string, { label: string; color: string }> = {
  MINOR: { label: 'Незначительное', color: 'gold' },
  MAJOR: { label: 'Существенное', color: 'orange' },
  CRITICAL: { label: 'Критическое', color: 'red' },
};
/** Порядок значимости для сортировки «Уровня» — не алфавитный (MINOR < MAJOR < CRITICAL). */
export const NC_LEVEL_RANK: Record<string, number> = Object.fromEntries(
  Object.keys(NC_LEVEL).map((k, i) => [k, i]),
);

function authHeaders(): Record<string, string> {
  const t = localStorage.getItem('token');
  return t ? { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` }
    : { 'Content-Type': 'application/json' };
}

/** Тонкий клиент контура: бросает с текстом `detail` бэкенда, чтобы форма показала причину
 *  отказа валидации, а не безликое «HTTP 422». */
export async function api<T>(path: string, opts?: RequestInit): Promise<T> {
  const resp = await fetch(`${VITE_API}${path}`, { headers: authHeaders(), ...opts });
  if (!resp.ok) {
    let detail = '';
    try { detail = (await resp.json()).detail; } catch { /* без тела */ }
    throw new Error(detail || `HTTP ${resp.status}`);
  }
  return (resp.status === 204 ? undefined : await resp.json()) as T;
}
