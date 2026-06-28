/**
 * dynamicsSlice.ts — причины изменения качества по кварталам (вкладка «Динамика качества»).
 * Менеджер по качеству вносит обоснование изменения метрики/характеристики относительно
 * предыдущей оценки. Persist в localStorage (как governance).
 * Ключ причины: `${systemName}|${seriesKey}|${quarter}`.
 */
import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { RootState } from '../index';

const STORAGE_KEY = 'asok_dynamics_reasons';

function load(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}
function persist(reasons: Record<string, string>) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(reasons)); } catch { /* ignore */ }
}

export const reasonKey = (system: string, seriesKey: string, quarter: string) =>
  `${system}|${seriesKey}|${quarter}`;

interface DynamicsState { reasons: Record<string, string> }

const dynamicsSlice = createSlice({
  name: 'dynamics',
  initialState: { reasons: load() } as DynamicsState,
  reducers: {
    setReason(state, action: PayloadAction<{ key: string; text: string }>) {
      const t = action.payload.text.trim();
      if (t) state.reasons[action.payload.key] = t;
      else delete state.reasons[action.payload.key];
      persist(state.reasons);
    },
  },
});

export const { setReason } = dynamicsSlice.actions;
export const selectReasons = (s: RootState) => s.dynamics.reasons;
export default dynamicsSlice.reducer;
