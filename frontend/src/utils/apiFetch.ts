/**
 * apiFetch.ts — общий fetch-хелпер для live-эндпоинтов кокпита (ТЗ v21).
 *
 * Существующие страницы (RiskEconomicsPage, ExecutiveDashboard) уже используют этот же паттерн
 * (Bearer-токен из localStorage + VITE_API_BASE_URL), каждая — своей копией. Кокпит переиспользует
 * его в общем виде, не трогая уже работающий код тех страниц (см. границы ТЗ v21 §17).
 */
const VITE_API = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api/v1';

function authHeaders(): Record<string, string> {
  const t = localStorage.getItem('token');
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export async function apiGet<T>(path: string): Promise<T> {
  const resp = await fetch(`${VITE_API}${path}`, { headers: authHeaders() });
  if (!resp.ok) {
    let detail = '';
    try { detail = (await resp.json()).detail; } catch { /* без тела */ }
    throw new Error(detail || `HTTP ${resp.status}`);
  }
  return resp.json();
}

export function qs(params: Record<string, string | string[] | undefined | null>): string {
  const p = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return;
    p.set(k, Array.isArray(v) ? v.join(',') : v);
  });
  const s = p.toString();
  return s ? `?${s}` : '';
}
