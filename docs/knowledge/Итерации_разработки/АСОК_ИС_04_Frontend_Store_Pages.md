---
tags:
  - фронт
---

# АСОК ИС — Frontend: Store, API slices, Pages (итерация 1)
**Дата:** 2026-05-17

## frontend/src/store/index.ts
```typescript
import { configureStore } from '@reduxjs/toolkit';
import { setupListeners } from '@reduxjs/toolkit/query';
import { TypedUseSelectorHook, useDispatch, useSelector } from 'react-redux';
import { authReducer } from './slices/authSlice';
import { uiReducer } from './slices/uiSlice';
import { assessmentApi } from './api/assessmentApi';
import { authApi } from './api/authApi';

export const store = configureStore({
  reducer: {
    auth: authReducer,
    ui: uiReducer,
    [assessmentApi.reducerPath]: assessmentApi.reducer,
    [authApi.reducerPath]: authApi.reducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().concat(assessmentApi.middleware, authApi.middleware),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
export const useAppDispatch = () => useDispatch<AppDispatch>();
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
```

## frontend/src/store/slices/authSlice.ts
```typescript
import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export type UserRole = 'TEST_ANALYST' | 'QUALITY_MANAGER' | 'CTO' | 'CEO' | 'ADMIN';

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  role: UserRole | null;
  isAuthenticated: boolean;
}

const authSlice = createSlice({
  name: 'auth',
  initialState: {
    accessToken: localStorage.getItem('asok_access_token'),
    refreshToken: localStorage.getItem('asok_refresh_token'),
    role: localStorage.getItem('asok_role') as UserRole | null,
    isAuthenticated: !!localStorage.getItem('asok_access_token'),
  } as AuthState,
  reducers: {
    setCredentials(state, action: PayloadAction<{ accessToken: string; refreshToken: string; role: UserRole }>) {
      const { accessToken, refreshToken, role } = action.payload;
      state.accessToken = accessToken;
      state.refreshToken = refreshToken;
      state.role = role;
      state.isAuthenticated = true;
      localStorage.setItem('asok_access_token', accessToken);
      localStorage.setItem('asok_refresh_token', refreshToken);
      localStorage.setItem('asok_role', role);
    },
    clearCredentials(state) {
      state.accessToken = null;
      state.refreshToken = null;
      state.role = null;
      state.isAuthenticated = false;
      localStorage.removeItem('asok_access_token');
      localStorage.removeItem('asok_refresh_token');
      localStorage.removeItem('asok_role');
    },
  },
});

export const { setCredentials, clearCredentials } = authSlice.actions;
export const authReducer = authSlice.reducer;
export const selectIsAuthenticated = (s: { auth: AuthState }) => s.auth.isAuthenticated;
export const selectUserRole = (s: { auth: AuthState }) => s.auth.role;
export const selectAccessToken = (s: { auth: AuthState }) => s.auth.accessToken;
```

## frontend/src/store/slices/uiSlice.ts
```typescript
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
```

## frontend/src/store/api/authApi.ts
```typescript
import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import type { RootState } from '../index';

export const authApi = createApi({
  reducerPath: 'authApi',
  baseQuery: fetchBaseQuery({
    baseUrl: '/api/v1',
    prepareHeaders: (headers, { getState }) => {
      const token = (getState() as RootState).auth.accessToken;
      if (token) headers.set('Authorization', `Bearer ${token}`);
      return headers;
    },
  }),
  endpoints: (builder) => ({
    login: builder.mutation<{ access_token: string; refresh_token: string; token_type: string; role: string }, { username: string; password: string }>({
      query: (body) => ({ url: '/auth/login', method: 'POST', body }),
    }),
    refreshToken: builder.mutation<{ access_token: string; refresh_token: string; token_type: string; role: string }, { refresh_token: string }>({
      query: (body) => ({ url: '/auth/refresh', method: 'POST', body }),
    }),
  }),
});

export const { useLoginMutation, useRefreshTokenMutation } = authApi;
```

## frontend/src/store/api/assessmentApi.ts
RTK Query endpoints:
- `getSystems` — GET /systems (фильтры: status_lc, criticality_class)
- `createAssessment` — POST /assessments
- `getAssessmentMetrics` — GET /assessments/{id}/metrics
- `updateMetricValue` — PUT /metrics/{id}
- `createExpertJudgment` — POST /expert-review
- `triggerAiSummary` — POST /ai/summary
- `getTaskStatus` — GET /excel/tasks/{task_id} (polling)

Теги кэша: Systems, Assessments, Metrics, ExpertJudgments
Инвалидация: updateMetricValue → Metrics; createExpertJudgment → Metrics + ExpertJudgments

## frontend/src/pages/LoginPage.tsx
- Form (Ant Design) + демо-кнопки (demo/manager, demo/analyst)
- При успехе: dispatch(setCredentials) → navigate('/dashboard')
- Единое сообщение об ошибке через RTK Query error state

## frontend/src/pages/MetricsInputPage.tsx
- Table 28 строк с InputNumber для val_a/val_b
- disabled если data_source != MANUAL
- val_b = 0 → status="error" + Tooltip
- RAG теги: зелёный ≥0.81, жёлтый 0.41–0.80, красный <0.41, серый — нет данных
- Кнопка "Сохранить" per-row, disabled пока isDirty=false или valBError=true

## frontend/src/components/AiInsightBanner.tsx
- Polling getTaskStatus каждые 3 сек пока PENDING/STARTED
- max 3 retry с exponential backoff (BASE=2000ms)
- Ошибка → Alert ⚠️ + кнопка 🔄 Повторить
- Успех → Card с summary текстом
