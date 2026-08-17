/**
 * govApi.ts — общий транспорт к /governance/* (вынесен из governanceSlice.ts, ТЗ v19 §17):
 * governanceSlice.ts и governanceCardThunks.ts делят один helper, а не дублируют fetch-обвязку.
 */
const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v1';

export async function govApi(path: string, method: string, body?: unknown): Promise<any> {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE}/governance${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`governance ${method} ${path} → ${res.status}`);
  return res.json();
}
