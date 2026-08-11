import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { type ThemeName, isThemeName, DEFAULT_FONT_KEY, FONT_OPTIONS } from '../../theme/themes';

/** Источник данных дашбордов: 'mock' — демо для презентации, 'live' — реальное API + LLM. */
export type DataMode = 'mock' | 'live';

const DATA_MODE_KEY = 'asok_data_mode';
const FEATURE_KEY = 'asok_exec_features';
const THEME_KEY = 'asok_theme';
const FONT_KEY = 'asok_font';

function loadDataMode(): DataMode {
  return localStorage.getItem(DATA_MODE_KEY) === 'live' ? 'live' : 'mock';
}

function loadThemeName(): ThemeName {
  const v = localStorage.getItem(THEME_KEY);
  return isThemeName(v) ? v : 'premium';
}

function loadFontKey(): string {
  const v = localStorage.getItem(FONT_KEY);
  return FONT_OPTIONS.some((f) => f.key === v) ? (v as string) : DEFAULT_FONT_KEY;
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
  // По умолчанию ВКЛЮЧЕНЫ: у топ-менеджмента доступные дашборды видны сразу, а переключатели в
  // «Настройка» позволяют СКРЫТЬ ненужные (раньше флаги ни на что не влияли — были косметическими).
  // Так фича функциональна с первого входа и без «пропавшего» стартового дашборда.
  const def: ExecFeatures = { execAnalytics: true, execDynamics: true, execTaskPlan: true, execIncidents: true };
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
  /** Активная тема оформления (ТЗ v17): premium · classic (Windows) · graphite (тёмная). */
  themeName: ThemeName;
  /** Ключ выбранного шрифта (theme/themes.ts FONT_OPTIONS). */
  fontKey: string;
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
    themeName: loadThemeName(),
    fontKey: loadFontKey(),
    dataMode: loadDataMode(),
    ...loadFeatures(),
  } as UiState,
  reducers: {
    openModal(state, action: PayloadAction<string>) { state.activeModal = action.payload; },
    closeModal(state) { state.activeModal = null; },
    setGlobalLoading(state, action: PayloadAction<boolean>) { state.globalLoading = action.payload; },
    toggleTheme(state) { state.theme = state.theme === 'light' ? 'dark' : 'light'; },
    setThemeName(state, action: PayloadAction<ThemeName>) {
      state.themeName = action.payload;
      localStorage.setItem(THEME_KEY, action.payload);
    },
    setFontKey(state, action: PayloadAction<string>) {
      state.fontKey = action.payload;
      localStorage.setItem(FONT_KEY, action.payload);
    },
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
  openModal, closeModal, setGlobalLoading, toggleTheme, setThemeName, setFontKey, setDataMode, setExecFeature,
} = uiSlice.actions;
export const uiReducer = uiSlice.reducer;
