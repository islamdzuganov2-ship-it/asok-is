import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ConfigProvider, Spin } from 'antd';
import ruRU from 'antd/locale/ru_RU';
import { useSelector } from 'react-redux';
import { RootState } from './store';
import { AppLayout } from './components/AppLayout';

const LoginPage = lazy(() => import('./pages/LoginPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const ExecutiveDashboard = lazy(() => import('./pages/dashboard/ExecutiveDashboard'));
const ManagerDashboard = lazy(() => import('./pages/dashboard/ManagerDashboard'));
const QualityDynamicsPage = lazy(() => import('./pages/dashboard/QualityDynamicsPage'));
const TaskPlanDashboard = lazy(() => import('./pages/dashboard/TaskPlanDashboard'));
const IncidentsAnalyticsPage = lazy(() => import('./pages/dashboard/IncidentsAnalyticsPage'));
const RiskRadarPage = lazy(() => import('./pages/dashboard/RiskRadarPage'));
const AssessmentWorkspacePage = lazy(() => import('./pages/AssessmentWorkspacePage'));
const AiAssessmentPage = lazy(() => import('./pages/AiAssessmentPage'));
const MetricsInputPage = lazy(() => import('./pages/MetricsInputPage'));
const ExpertReviewPage = lazy(() => import('./pages/ExpertReviewPage'));
const AdminFlagsPage = lazy(() => import('./pages/AdminFlagsPage'));
const ExcelReportsPage = lazy(() => import('./pages/ExcelReportsPage'));
const RiskBasePage = lazy(() => import('./pages/RiskBasePage'));

const PageLoader = () => (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin size="large" tip="Загрузка..." />
    </div>
);

const RequireAuth: React.FC<{ children: React.ReactElement }> = ({ children }) => {
    const { isAuthenticated } = useSelector((state: RootState) => state.auth);
    return isAuthenticated ? children : <Navigate to="/login" replace />;
};

// Ролевая маршрутизация для /dashboard: каждый пользователь попадает на «свой» дашборд
// (устраняет путаницу «какой из дашбордов мой», ТЗ v11 R1.1).
const EXECUTIVE_ROLES = ['CTO', 'CEO', 'CIO', 'EXECUTIVE', 'ADMIN'];
const DashboardRouter: React.FC = () => {
    const { role } = useSelector((state: RootState) => state.auth);
    if (role && EXECUTIVE_ROLES.includes(role)) return <Navigate to="/dashboard/executive" replace />;
    if (role === 'QUALITY_MANAGER') return <Navigate to="/dashboard/manager" replace />;
    return <Navigate to="/dashboard/analytics" replace />;
};

const RequireRole: React.FC<{ allowedRoles: string[], children: React.ReactElement }> = ({ allowedRoles, children }) => {
    const { role } = useSelector((state: RootState) => state.auth);
    return (role && allowedRoles.includes(role)) ? children : <Navigate to="/dashboard" replace />;
};

export const App: React.FC = () => {
    return (
        <ConfigProvider
            locale={ruRU}
            theme={{
                token: {
                    // Приглушённая, пастельная палитра (менее «кричащие» тона).
                    colorPrimary: '#3A4F6B',
                    colorSuccess: '#6F9F86',
                    colorWarning: '#C9A14A',
                    colorError: '#C06B5A',
                    colorInfo: '#6E89A6',
                },
            }}
        >
            <BrowserRouter>
                <Suspense fallback={<PageLoader />}>
                    <Routes>
                        <Route path="/login" element={<LoginPage />} />
                        <Route path="/*" element={<RequireAuth><AppLayout><Suspense fallback={<PageLoader />}><Routes>
                            <Route path="dashboard" element={<DashboardRouter />} />
                            <Route path="dashboard/analytics" element={<DashboardPage />} />
                            <Route path="dashboard/executive" element={<RequireRole allowedRoles={['CTO', 'CEO', 'CIO', 'EXECUTIVE', 'ADMIN']}><ExecutiveDashboard /></RequireRole>} />
                            <Route path="dashboard/manager" element={<RequireRole allowedRoles={['QUALITY_MANAGER', 'ADMIN']}><ManagerDashboard /></RequireRole>} />
                            <Route path="dashboard/manager/dynamics" element={<RequireRole allowedRoles={['QUALITY_MANAGER', 'CTO', 'CEO', 'CIO', 'EXECUTIVE', 'ADMIN']}><QualityDynamicsPage /></RequireRole>} />
                            <Route path="dashboard/taskplan" element={<RequireRole allowedRoles={['QUALITY_MANAGER', 'CTO', 'CEO', 'CIO', 'EXECUTIVE', 'ADMIN']}><TaskPlanDashboard /></RequireRole>} />
                            <Route path="dashboard/incidents" element={<RequireRole allowedRoles={['QUALITY_MANAGER', 'CTO', 'CEO', 'CIO', 'EXECUTIVE', 'ADMIN']}><IncidentsAnalyticsPage /></RequireRole>} />
                            <Route path="dashboard/risk-radar" element={<RequireRole allowedRoles={['QUALITY_MANAGER', 'CTO', 'CEO', 'CIO', 'EXECUTIVE', 'ADMIN']}><RiskRadarPage /></RequireRole>} />
                            <Route path="assessments/new" element={<RequireRole allowedRoles={['TEST_ANALYST', 'QUALITY_MANAGER', 'ADMIN']}><AssessmentWorkspacePage /></RequireRole>} />
                            {/* ПОД РАЗВИТИЕ: «Оценка СИИ» (ГОСТ Р 59898-2021) и история ИИ-оценок.
                                Пункт меню и переключатель в «Настройка» намеренно убраны из UI (раздел
                                пока не нужен). Маршрут и страница (AiAssessmentPage) сохранены в коде;
                                чтобы вернуть раздел — добавить пункт меню в AppLayout.tsx. */}
                            <Route path="ai-assessments" element={<RequireRole allowedRoles={['TEST_ANALYST', 'QUALITY_MANAGER', 'ADMIN']}><AiAssessmentPage /></RequireRole>} />
                            <Route path="assessments/:id/input" element={<RequireRole allowedRoles={['TEST_ANALYST', 'QUALITY_MANAGER', 'ADMIN']}><MetricsInputPage /></RequireRole>} />
                            <Route path="assessments/:id/review" element={<RequireRole allowedRoles={['QUALITY_MANAGER', 'ADMIN']}><ExpertReviewPage /></RequireRole>} />
                            <Route path="reports" element={<ExcelReportsPage />} />
                            <Route path="risks" element={<RiskBasePage />} />
                            <Route path="admin/flags" element={<RequireRole allowedRoles={['CTO', 'CEO', 'CIO', 'EXECUTIVE', 'ADMIN']}><AdminFlagsPage /></RequireRole>} />
                            <Route index element={<Navigate to="/dashboard" replace />} />
                        </Routes></Suspense></AppLayout></RequireAuth>} />
                    </Routes>
                </Suspense>
            </BrowserRouter>
        </ConfigProvider>
    );
};

export default App;
