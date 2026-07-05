/**
 * dynamicsSlice.ts — причины изменения качества по кварталам (вкладка «Динамика качества»).
 * Менеджер по качеству вносит обоснование изменения метрики/характеристики относительно
 * предыдущей оценки. Persist в localStorage (как governance).
 * Ключ причины: `${systemName}|${seriesKey}|${quarter}`.
 */
import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { RootState } from '../index';
import { DYNAMICS_REASONS } from '../../data/mockScaleData';

const STORAGE_KEY = 'asok_dynamics_reasons_v2';
const OLD_KEYS = ['asok_dynamics_reasons'];

function load(): Record<string, string> {
  try {
    OLD_KEYS.forEach((k) => localStorage.removeItem(k)); // чистим устаревшие демо-данные
    const raw = localStorage.getItem(STORAGE_KEY);
    const saved = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    // Сценарные причины от МК подмешиваются под сохранённые (правки пользователя приоритетнее).
    return { ...DYNAMICS_REASONS, ...saved };
  } catch {
    return { ...DYNAMICS_REASONS };
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
