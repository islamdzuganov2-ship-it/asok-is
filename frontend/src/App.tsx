/**
 * Корневой компонент приложения.
 * Содержит настройку Ant Design (тема, локаль) и конфигурацию React Router v6.
 * Реализован Lazy Loading для страниц и базовая защита маршрутов.
 */
import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ConfigProvider, Spin, Layout } from 'antd';
import ruRU from 'antd/locale/ru_RU';

// Заглушки для аутентификации и проверки ролей (В реальном проекте берутся из Redux)
const isAuthenticated = () => !!localStorage.getItem('token');
const getUserRole = () => localStorage.getItem('role') || 'ANALYST';

// Lazy-компоненты для code-splitting
const LoginPage = lazy(() => import('./pages/LoginPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const NewAssessmentPage = lazy(() => import('./pages/NewAssessmentPage'));
const MetricsInputPage = lazy(() => import('./pages/MetricsInputPage'));
const ExpertReviewPage = lazy(() => import('./pages/ExpertReviewPage'));
const AdminFlagsPage = lazy(() => import('./pages/AdminFlagsPage'));

const PageLoader = () => (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin size="large" tip="Загрузка модуля..." />
    </div>
);

// HOC для защиты маршрутов (Требование ТЗ)
const RequireAuth: React.FC<{ children: React.ReactElement }> = ({ children }) => {
    return isAuthenticated() ? children : <Navigate to="/login" replace />;
};

// HOC для проверки ролевой модели (RBAC)
const RequireRole: React.FC<{ allowedRoles: string[], children: React.ReactElement }> = ({ allowedRoles, children }) => {
    const role = getUserRole();
    return allowedRoles.includes(role) ? children : <Navigate to="/dashboard" replace />;
};

export const App: React.FC = () => {
    return (
        <ConfigProvider
            locale={ruRU}
            theme={{
                token: {
                    colorPrimary: '#1F3864', // Корпоративный цвет из ТЗ
                    fontFamily: 'Inter, sans-serif',
                },
            }}
        >
            <BrowserRouter>
                <Suspense fallback={<PageLoader />}>
                    <Routes>
                        <Route path="/login" element={<LoginPage />} />
                        
                        {/* Защищенные маршруты */}
                        <Route path="/" element={
                            <RequireAuth>
                                <Layout style={{ minHeight: '100vh' }}>
                                    {/* Здесь должен быть ваш Sidebar/Header */}
                                    <Layout.Content style={{ padding: '24px', background: '#f0f2f5' }}>
                                        <Routes>
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
                                            <Route path="admin/flags" element={
                                                <RequireRole allowedRoles={['ADMIN']}>
                                                    <AdminFlagsPage />
                                                </RequireRole>
                                            } />
                                            <Route path="*" element={<Navigate to="/dashboard" replace />} />
                                        </Routes>
                                    </Layout.Content>
                                </Layout>
                            </RequireAuth>
                        } />
                    </Routes>
                </Suspense>
            </BrowserRouter>
        </ConfigProvider>
    );
};

export default App;