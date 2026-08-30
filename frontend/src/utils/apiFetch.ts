/**
 * apiFetch.ts — построение query-строки для RTK Query эндпоинтов кокпита (ТЗ v21 §10.5).
 */
export function qs(params: Record<string, string | string[] | undefined | null>): string {
  const p = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return;
    p.set(k, Array.isArray(v) ? v.join(',') : v);
  });
  const s = p.toString();
  return s ? `?${s}` : '';
}
