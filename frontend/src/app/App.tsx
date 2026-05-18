import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ConfigProvider, Spin } from 'antd';
import ruRU from 'antd/locale/ru_RU';
import { useSelector } from 'react-redux';
import { RootState } from './store';
import { AppLayout } from './components/AppLayout';

const LoginPage = lazy(() => import('./pages/LoginPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const NewAssessmentPage = lazy(() => import('./pages/NewAssessmentPage'));
const MetricsInputPage = lazy(() => import('./pages/MetricsInputPage'));
const ExpertReviewPage = lazy(() => import('./pages/ExpertReviewPage'));
// const AdminFlagsPage = lazy(() => import('./pages/AdminFlagsPage')); // Раскомментировать при наличии

const PageLoader = () => (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin size="large" tip="Загрузка модуля..." />
    </div>
);

const RequireAuth: React.FC<{ children: React.ReactElement }> = ({ children }) => {
    const isAuthenticated = useSelector((state: RootState) => state.auth.isAuthenticated);
    return isAuthenticated ? children : <Navigate to="/login" replace />;
};

const RequireRole: React.FC<{ allowedRoles: string[], children: React.ReactElement }> = ({ allowedRoles, children }) => {
    const role = useSelector((state: RootState) => state.auth.role) || 'GUEST';
    return allowedRoles.includes(role) ? children : <Navigate to="/dashboard" replace />;
};

export const App: React.FC = () => {
    return (
        <ConfigProvider
            locale={ruRU}
            theme={{ token: { colorPrimary: '#1F3864', fontFamily: 'Inter, sans-serif' } }}
        >
            <BrowserRouter>
                <Suspense fallback={<PageLoader />}>
                    <Routes>
                        <Route path="/login" element={<LoginPage />} />
                        <Route path="/" element={<RequireAuth><AppLayout><Suspense fallback={<PageLoader />}><Routes>
                            <Route path="dashboard" element={<DashboardPage />} />
                            <Route path="assessments/new" element={
                                <RequireRole allowedRoles={['TEST_ANALYST', 'QUALITY_MANAGER', 'ADMIN']}>
                                    <NewAssessmentPage />
                                </RequireRole>
                            } />
                            <Route path="assessments/:id/input" element={
                                <RequireRole allowedRoles={['TEST_ANALYST', 'QUALITY_MANAGER', 'ADMIN']}>
                                    <MetricsInputPage />
                                </RequireRole>
                            } />
                            <Route path="assessments/:id/review" element={
                                <RequireRole allowedRoles={['QUALITY_MANAGER', 'ADMIN']}>
                                    <ExpertReviewPage />
                                </RequireRole>
                            } />
                            <Route path="*" element={<Navigate to="/dashboard" replace />} />
                        </Routes></Suspense></AppLayout></RequireAuth>} />
                    </Routes>
                </Suspense>
            </BrowserRouter>
        </ConfigProvider>
    );
};

export default App;