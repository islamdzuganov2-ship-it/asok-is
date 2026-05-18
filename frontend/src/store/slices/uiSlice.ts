import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface UiState { activeModal: string | null; globalLoading: boolean; theme: 'light' | 'dark'; }

const uiSlice = createSlice({
  name: 'ui',
  initialState: { activeModal: null, globalLoading: false, theme: 'light' } as UiState,
  reducers: {
    openModal(state, action: PayloadAction<string>) { state.activeModal = action.payload; },
    closeModal(state) { state.activeModal = null; },
    setGlobalLoading(state, action: PayloadAction<boolean>) { state.globalLoading = action.payload; },
    toggleTheme(state) { state.theme = state.theme === 'light' ? 'dark' : 'light'; },
  },
});

export const { openModal, closeModal, setGlobalLoading, toggleTheme } = uiSlice.actions;
export const uiReducer = uiSlice.reducer;