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