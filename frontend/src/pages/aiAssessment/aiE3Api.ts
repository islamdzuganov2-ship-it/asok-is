/**
 * aiE3Api.ts — транспорт и контракты этапа E3 контура СИИ (ГОСТ Р 59898-2021; BL-001):
 * тестовые наборы и выбросы, паритет сред, экспертная группа, условия испытаний, сравнение СИИ.
 */
const API = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api/v1';

export async function aiApi<T>(path: string, init?: RequestInit): Promise<T> {
  const token = localStorage.getItem('token');
  const r = await fetch(`${API}/ai-assessments${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(typeof body.detail === 'string' ? body.detail : `HTTP ${r.status}`);
  }
  return r.status === 204 ? (undefined as T) : r.json();
}

export interface Dataset {
  id: string; name: string; purpose: string; records: number | null; source: string | null;
  collected_from: string | null; representativeness: string | null;
  class_balance: Record<string, number> | null; outlier_method: string | null; outlier_k: number | null;
  outlier_feature: string | null; outliers_count: number | null; outliers_share: number | null;
  outlier_handling: string | null; notes: string | null;
}
export interface ParityRow { factor: string; label?: string; test_env: string | null; prod_env: string | null; status: string; justification: string | null }
export interface ParitySummary { ok: boolean; missing: string[]; mismatches: string[]; unjustified: string[]; checked: number; total: number }
export interface ParityOut { rows: ParityRow[]; factors: { code: string; label: string }[]; summary: ParitySummary }
export interface Kendall {
  m: number; n: number; w: number | null; chi2: number | null; df: number | null; p_value: number | null;
  consistent: boolean; threshold: number; note: string | null;
}
export interface ConsensusOut {
  experts: { login: string; name: string | null; scored: number }[];
  kendall: Kendall;
  objects: { characteristic: string; subcharacteristic: string; mean: number | null; rank_sum: number | null; scores: Record<string, number | null> }[];
}
export interface TestConditions {
  datasets: number; datasets_without_outlier_criterion: string[]; parity: ParitySummary;
  expert_group: Kendall | null; ready: boolean; gaps: string[];
}
export interface CompareOut {
  common: { characteristic: string; subcharacteristic: string; values: number[] }[];
  excluded: { characteristic: string; subcharacteristic: string; reason: string }[];
  ranking: { period_id: string; system: string; period: string; q_common: number | null; level: string; q_full: number | null }[];
  note: string;
}

export const PARITY_STATUS: Record<string, { label: string; color: string }> = {
  MATCH: { label: 'совпадает', color: 'green' },
  ACCEPTABLE: { label: 'отличие обосновано', color: 'gold' },
  MISMATCH: { label: 'расхождение', color: 'red' },
};

/** Разбор значений признака из текстового поля: разделитель — пробел, «;» или перевод строки;
 * запятая — десятичный разделитель (как в выгрузках из русской локали Excel). */
export const parseNumbers = (text: string): number[] =>
  text.split(/[\s;]+/).filter(Boolean).map((s) => Number(s.replace(',', '.'))).filter((n) => Number.isFinite(n));

/** Вердикт по W Кендалла для подписи рядом с числом. */
export const kendallVerdict = (k: Kendall | null): string => {
  if (!k || k.w == null) return k?.note || 'нужно не меньше двух экспертов и двух общих субхарактеристик';
  const strength = k.w >= 0.7 ? 'высокая' : k.w >= 0.5 ? 'достаточная' : k.w >= 0.3 ? 'слабая' : 'отсутствует';
  return `W = ${k.w.toFixed(3)} — согласованность ${strength}; χ² = ${k.chi2}, df = ${k.df}, p = ${k.p_value}`
    + (k.consistent ? ' (значима)' : ' (группа не согласована)');
};

/** Логин текущего пользователя из access-токена (claim `username`) — чтобы отличить свою колонку
 * оценок от оценок других экспертов. Токен не проверяется: это подпись UI, права — на сервере. */
export const currentLogin = (): string => {
  try {
    const payload = (localStorage.getItem('token') || '').split('.')[1] || '';
    const json = JSON.parse(decodeURIComponent(escape(atob(payload.replace(/-/g, '+').replace(/_/g, '/')))));
    return typeof json.username === 'string' ? json.username : '';
  } catch { return ''; }
};
