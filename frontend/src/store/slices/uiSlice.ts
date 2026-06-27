import { createSlice, PayloadAction } from '@reduxjs/toolkit';

/** Источник данных дашбордов: 'mock' — демо для презентации, 'live' — реальное API + LLM. */
export type DataMode = 'mock' | 'live';

const DATA_MODE_KEY = 'asok_data_mode';

function loadDataMode(): DataMode {
  return localStorage.getItem(DATA_MODE_KEY) === 'live' ? 'live' : 'mock';
}

interface UiState {
  activeModal: string | null;
  globalLoading: boolean;
  theme: 'light' | 'dark';
  dataMode: DataMode;
}

const uiSlice = createSlice({
  name: 'ui',
  initialState: {
    activeModal: null,
    globalLoading: false,
    theme: 'light',
    dataMode: loadDataMode(),
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
  },
});

export const { openModal, closeModal, setGlobalLoading, toggleTheme, setDataMode } = uiSlice.actions;
export const uiReducer = uiSlice.reducer;
