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
  // RE-03: условия вендорского контракта — пакет часов, сверхлимит, квант биллинга.
  packageHours?: number | null; overlimitRate?: number | null; billingQuantumMin?: number;
  // УК-25: MANUAL — вручную; REFERENCE — из справочника типовых (до подтверждения помечается).
  source?: 'MANUAL' | 'REFERENCE'; confirmedAt?: string | null; confirmedBy?: string | null;
}
export interface BusinessProcess {
  id: string; code: string; name: string; kind: string; owner?: string | null; isActive: boolean;
}
export interface BpCost {
  id: string; businessProcessId: string; method: string; costPerMinBase?: number | null;
  params?: Record<string, number> | null; timeProfile?: Record<string, unknown> | null;
  // RE-02: диапазон экспертно-ступенчатой оценки — неопределённость видна рядом с числом.
  costPerMinLow?: number | null; costPerMinHigh?: number | null;
}

/** RE-02: параметры метода C_мин из полей формы (ключи — как ждёт бэкенд). */
export function bpCostParams(method: string, v: Record<string, number | undefined>): Record<string, number> {
  const keys = method === 'TRANSACTIONAL' ? ['revenue_per_period', 'minutes_per_period', 'process_share']
    : method === 'EXPERT' ? ['low', 'high']
      : ['n_employees', 'hourly_rate', 'k_idle', 'k_catchup'];
  const out: Record<string, number> = {};
  for (const k of keys) if (typeof v[k] === 'number') out[k] = v[k] as number;
  return out;
}

/** RE-02: временной профиль C_мин — пик/непик × будни/выходные; пусто — без профиля. */
export function bpTimeProfile(v: Record<string, number | undefined>): Record<string, unknown> | null {
  if (v.peakFrom == null && v.offpeak == null && v.weekend == null) return null;
  return {
    peak_hours: [v.peakFrom ?? 9, v.peakTo ?? 18],
    peak: v.peak ?? 1,
    offpeak: v.offpeak ?? 1,
    weekend: v.weekend ?? v.offpeak ?? 1,
  };
}

/** ТЗ v19 п.9-10, В-30а: source/observedOn обязательны на бэкенде — бенчмарк без источника
 *  и даты наблюдения отклоняется валидацией, чтобы «рынок» нельзя было выдумать. */
export interface MarketBenchmark {
  id: string; kind: string; dimension: string; companySizeClass?: string | null;
  // УК-25: разрез типовой ставки — линия, отрасль, квалификация (пусто = «любая»).
  line?: string | null; industry?: string | null; qualification?: string | null;
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
