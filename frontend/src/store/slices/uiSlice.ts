import { createSlice, PayloadAction } from '@reduxjs/toolkit';

/** Источник данных дашбордов: 'mock' — демо для презентации, 'live' — реальное API + LLM. */
export type DataMode = 'mock' | 'live';

const DATA_MODE_KEY = 'asok_data_mode';
const FEATURE_KEY = 'asok_exec_features';

function loadDataMode(): DataMode {
  return localStorage.getItem(DATA_MODE_KEY) === 'live' ? 'live' : 'mock';
}

/** Опциональные для топ-менеджера дашборды (включаются в «Настройка»). */
export interface ExecFeatures {
  execAnalytics: boolean;  // «Аналитический дашборд»
  execDynamics: boolean;   // «Динамика качества»
  execTaskPlan: boolean;   // «План задач по повышению качества»
  execIncidents: boolean;  // «Аналитика технических сбоев» (T-21)
}
export type ExecFeatureKey = keyof ExecFeatures;

function loadFeatures(): ExecFeatures {
  const def: ExecFeatures = { execAnalytics: false, execDynamics: false, execTaskPlan: false, execIncidents: false };
  try {
    return { ...def, ...JSON.parse(localStorage.getItem(FEATURE_KEY) || '{}') };
  } catch {
    return def;
  }
}

interface UiState {
  activeModal: string | null;
  globalLoading: boolean;
  theme: 'light' | 'dark';
  dataMode: DataMode;
  execAnalytics: boolean;
  execDynamics: boolean;
  execTaskPlan: boolean;
  execIncidents: boolean;
}

const uiSlice = createSlice({
  name: 'ui',
  initialState: {
    activeModal: null,
    globalLoading: false,
    theme: 'light',
    dataMode: loadDataMode(),
    ...loadFeatures(),
  } as UiState,
  reducers: {
    openModal(state, action: PayloadAction<string>) { state.activeModal = action.payload; },
    closeModal(state) { state.activeModal = null; },
    setGlobalLoading(state, action: PayloadAction<boolean>) { state.globalLoading = action.payload; },
    toggleTheme(state) { state.theme = state.theme === 'light' ? 'dark' : 'light'; },
    setDataMode(state, action: PayloadAction<DataMode>) {
      state.dataMode = action.payload;
      localStorage.setItem(DATA_MODE_KEY, action.payload);
    },
    setExecFeature(state, action: PayloadAction<{ key: ExecFeatureKey; value: boolean }>) {
      state[action.payload.key] = action.payload.value;
      localStorage.setItem(FEATURE_KEY, JSON.stringify({
        execAnalytics: state.execAnalytics, execDynamics: state.execDynamics,
        execTaskPlan: state.execTaskPlan, execIncidents: state.execIncidents,
      }));
    },
  },
});

export const {
  openModal, closeModal, setGlobalLoading, toggleTheme, setDataMode, setExecFeature,
} = uiSlice.actions;
export const uiReducer = uiSlice.reducer;
