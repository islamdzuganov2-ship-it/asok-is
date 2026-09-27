/**
 * measureCardMeta.ts — справочные подписи карточки меры и горизонт ROSI (вынесено из
 * MeasureDecisionModal.tsx — потолок размера модуля, check-size.mjs).
 */
import type { ProposalStatus } from '../store/slices/governanceSlice';

const VITE_API = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api/v1';

// ТЗ v19 п.15: горизонт/ставка ROSI читаются из /econ/config (EconConfig — редактируется без
// деплоя, backend/app/modules/econ/service.py). Модуль-уровневый кэш — параметр общий для всех
// мер и не меняется на лету, повторный фетч на каждое открытие карточки не нужен.
export let horizonCache: { months: number; rate: number } | null = null;
export async function fetchRosiHorizon(): Promise<{ months: number; rate: number } | null> {
  if (horizonCache) return horizonCache;
  try {
    const token = localStorage.getItem('token');
    const r = await fetch(`${VITE_API}/econ/config`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!r.ok) return null;
    const items: { key: string; value: unknown }[] = await r.json();
    const months = items.find((i) => i.key === 'rosi_horizon_months')?.value;
    const rate = items.find((i) => i.key === 'discount_rate_annual')?.value;
    if (typeof months === 'number' && typeof rate === 'number') {
      horizonCache = { months, rate };
      return horizonCache;
    }
  } catch { /* необязательная подпись — тихо остаёмся без неё, ROSI-число всё равно верное */ }
  return null;
}

export const MEASURE_TYPE_LABEL: Record<string, string> = {
  ELIMINATING: 'Устраняющая (снимает первопричину)',
  COMPENSATING: 'Компенсирующая (снижает ущерб/вероятность)',
};
export const VERDICT_LABEL: Record<string, { label: string; color: string }> = {
  ELIMINATE: { label: 'Устранить', color: 'green' },
  COMPENSATE: { label: 'Компенсировать', color: 'gold' },
  ACCEPT: { label: 'Принять риск', color: 'default' },
};

export const STATUS_TAG: Record<ProposalStatus, { color: string; label: string }> = {
  PENDING_APPROVAL: { color: 'gold', label: 'Ожидает решения' },
  APPROVED: { color: 'green', label: 'Одобрена' },
  REJECTED: { color: 'red', label: 'Отклонена' },
};
