/**
 * Конфигурация Redux Store приложения.
 * Подключает API-слайсы (RTK Query) и локальные редьюсеры.
 */
import { configureStore } from '@reduxjs/toolkit';
import { setupListeners } from '@reduxjs/toolkit/query';
import { apiSlice } from './api/apiSlice';
import authReducer from './slices/authSlice';
import governanceReducer from './slices/governanceSlice';
import dynamicsReducer from './slices/dynamicsSlice';
import { uiReducer } from './slices/uiSlice';

export const store = configureStore({
    reducer: {
        // Локальное состояние авторизации
        auth: authReducer,
        // Governance-петля: меры/суждения, ожидающие одобрения топ-менеджмента
        governance: governanceReducer,
        // Причины изменения качества по кварталам (вкладка «Динамика качества»)
        dynamics: dynamicsReducer,
        // UI: тема, модалки, режим данных (моки ↔ LLM)
        ui: uiReducer,
        // RTK Query Cache & API Reducer
        [apiSlice.reducerPath]: apiSlice.reducer,
    },
    middleware: (getDefaultMiddleware) =>
        getDefaultMiddleware().concat(apiSlice.middleware),
});

// Настройка слушателей для refetchOnFocus и refetchOnReconnect
setupListeners(store.dispatch);

// Типизация хуков useSelector и useDispatch для TypeScript
export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;