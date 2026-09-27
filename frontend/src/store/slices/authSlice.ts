/**
 * Слайс аутентификации: JWT-токен, роль, ФИО и НАБОР ПРАВ пользователя (BL-008 RBAC).
 * Права приходят с `GET /iam/me/permissions` и кэшируются в localStorage для мгновенного
 * гейтинга на перезагрузке (затем обновляются с сервера в AppLayout).
 *
 * ИБ-11: `mustChangePassword` — вход выполнен временным паролем от администратора. Пока он не
 * сменён, сервер отвечает 403 `PASSWORD_CHANGE_REQUIRED` на всё, кроме смены пароля и выхода,
 * а RequireAuth держит пользователя на экране смены пароля.
 */
import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface AuthState {
    token: string | null;
    role: string | null;
    fullName: string | null;
    isAuthenticated: boolean;
    permissions: string[];
    permissionsLoaded: boolean;
    mustChangePassword: boolean;
}

function loadPermissions(): string[] {
    try {
        return JSON.parse(localStorage.getItem('permissions') || '[]');
    } catch {
        return [];
    }
}

const initialState: AuthState = {
    token: localStorage.getItem('token'),
    role: localStorage.getItem('role'),
    fullName: localStorage.getItem('full_name'),
    isAuthenticated: !!localStorage.getItem('token'),
    permissions: loadPermissions(),
    permissionsLoaded: !!localStorage.getItem('permissions'),
    mustChangePassword: localStorage.getItem('must_change_password') === '1',
};

function storeMustChange(value: boolean): void {
    if (value) localStorage.setItem('must_change_password', '1');
    else localStorage.removeItem('must_change_password');
}

const authSlice = createSlice({
    name: 'auth',
    initialState,
    reducers: {
        setCredentials: (
            state,
            action: PayloadAction<{ token: string; role: string; fullName: string; mustChangePassword?: boolean }>
        ) => {
            state.token = action.payload.token;
            state.role = action.payload.role;
            state.fullName = action.payload.fullName;
            state.isAuthenticated = true;
            state.mustChangePassword = !!action.payload.mustChangePassword;
            // Права нового пользователя ещё не загружены — форсируем перезапрос в AppLayout.
            state.permissions = [];
            state.permissionsLoaded = false;

            localStorage.setItem('token', action.payload.token);
            localStorage.setItem('role', action.payload.role);
            localStorage.setItem('full_name', action.payload.fullName);
            localStorage.removeItem('permissions');
            // Сброс скрытых уведомлений при новом входе («очистить всё» действует до следующего входа).
            localStorage.removeItem('asok_notif_dismissed');
            storeMustChange(state.mustChangePassword);
        },
        /** Сервер ответил 403 PASSWORD_CHANGE_REQUIRED — уводим на экран смены пароля. */
        requirePasswordChange: (state) => {
            state.mustChangePassword = true;
            storeMustChange(true);
        },
        /** Пароль сменён: сервер закрыл прежние сессии и выдал новый токен. */
        passwordChanged: (state, action: PayloadAction<{ token: string }>) => {
            state.token = action.payload.token;
            state.mustChangePassword = false;
            localStorage.setItem('token', action.payload.token);
            storeMustChange(false);
        },
        setPermissions: (state, action: PayloadAction<string[]>) => {
            state.permissions = action.payload;
            state.permissionsLoaded = true;
            localStorage.setItem('permissions', JSON.stringify(action.payload));
        },
        logout: (state) => {
            state.token = null;
            state.role = null;
            state.fullName = null;
            state.isAuthenticated = false;
            state.permissions = [];
            state.permissionsLoaded = false;
            state.mustChangePassword = false;

            localStorage.clear();
        },
    },
});

export const { setCredentials, setPermissions, logout, requirePasswordChange, passwordChanged } = authSlice.actions;
export default authSlice.reducer;
