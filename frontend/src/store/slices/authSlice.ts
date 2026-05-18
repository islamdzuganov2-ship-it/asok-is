/**
 * Слайс для управления состоянием аутентификации.
 * Хранит JWT токен, роль и данные пользователя.
 */
import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface AuthState {
    token: string | null;
    role: string | null;
    fullName: string | null;
    isAuthenticated: boolean;
}

const initialState: AuthState = {
    token: localStorage.getItem('token'),
    role: localStorage.getItem('role'),
    fullName: localStorage.getItem('full_name'),
    isAuthenticated: !!localStorage.getItem('token'),
};

const authSlice = createSlice({
    name: 'auth',
    initialState,
    reducers: {
        setCredentials: (
            state,
            action: PayloadAction<{ token: string; role: string; fullName: string }>
        ) => {
            state.token = action.payload.token;
            state.role = action.payload.role;
            state.fullName = action.payload.fullName;
            state.isAuthenticated = true;
            
            // Синхронизация с localStorage для сохранения сессии при перезагрузке
            localStorage.setItem('token', action.payload.token);
            localStorage.setItem('role', action.payload.role);
            localStorage.setItem('full_name', action.payload.fullName);
        },
        logout: (state) => {
            state.token = null;
            state.role = null;
            state.fullName = null;
            state.isAuthenticated = false;
            
            localStorage.clear();
        },
    },
});

export const { setCredentials, logout } = authSlice.actions;
export default authSlice.reducer;