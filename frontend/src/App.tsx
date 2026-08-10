import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ConfigProvider, Spin } from 'antd';
import ruRU from 'antd/locale/ru_RU';
import { useSelector } from 'react-redux';
import { RootState } from './store';
import { AppLayout } from './components/AppLayout';
import { BRAND, ACCENT, RAG } from './theme/ragPalette';
import { SPACE, TYPE } from './theme/premium';

const LoginPage = lazy(() => import('./pages/LoginPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const ExecutiveDashboard = lazy(() => import('./pages/dashboard/ExecutiveDashboard'));
const CtoDashboard = lazy(() => import('./pages/dashboard/CtoDashboard'));
const CeoDashboard = lazy(() => import('./pages/dashboard/CeoDashboard'));
const RiskOwnerDashboard = lazy(() => import('./pages/dashboard/RiskOwnerDashboard'));
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
const RiskEconomicsPage = lazy(() => import('./pages/RiskEconomicsPage'));
const UsersAdminPage = lazy(() => import('./pages/admin/UsersAdminPage'));
const PermissionsMatrixPage = lazy(() => import('./pages/admin/PermissionsMatrixPage'));
const LlmQualityPage = lazy(() => import('./pages/admin/LlmQualityPage'));

// `tip` у antd работает только во вложенном/полноэкранном режиме — иначе спиннер сыплет
// предупреждениями в консоль на каждой ленивой загрузке. Подпись выводим сами (UI-10).
const PageLoader = () => (
    <div style={{
        display: 'flex', flexDirection: 'column', gap: SPACE.cozy,
        justifyContent: 'center', alignItems: 'center', height: '100vh',
    }}>
        <Spin size="large" />
        <span style={{ ...TYPE.caption, color: BRAND.inkSoft }}>Загрузка…</span>
    </div>
);

const RequireAuth: React.FC<{ children: React.ReactElement }> = ({ children }) => {
    const { isAuthenticated } = useSelector((state: RootState) => state.auth);
    return isAuthenticated ? children : <Navigate to="/login" replace />;
};

// Посадочная страница /dashboard: каждая роль — на «свой» основной дашборд (ТЗ v11 R1.1),
// но проверяем ПРАВО на него (супер-админ мог его снять) — иначе первый доступный по правам.
const HOME_BY_ROLE: Record<string, { path: string; perm?: string }> = {
    SUPER_ADMIN: { path: '/admin/users', perm: 'view.admin.users' },
    ADMIN: { path: '/dashboard/analytics', perm: 'view.dashboard.analytics' },
    CTO: { path: '/dashboard/cto', perm: 'view.dashboard.cto' },
    CEO: { path: '/dashboard/ceo', perm: 'view.dashboard.ceo' },
    QUALITY_MANAGER: { path: '/dashboard/manager', perm: 'view.dashboard.manager' },
    RISK_MANAGER: { path: '/dashboard/risk', perm: 'view.dashboard.risk' },
    TEST_ANALYST: { path: '/dashboard/analytics', perm: 'view.dashboard.analytics' },
    AUDITOR: { path: '/dashboard/risk', perm: 'view.dashboard.risk' },
};
// Порядок «первого доступного» дашборда, если у роли нет своего.
const DASHBOARD_FALLBACKS: Array<{ path: string; perm: string }> = [
    { path: '/dashboard/cto', perm: 'view.dashboard.cto' },
    { path: '/dashboard/ceo', perm: 'view.dashboard.ceo' },
    { path: '/dashboard/manager', perm: 'view.dashboard.manager' },
    { path: '/dashboard/risk', perm: 'view.dashboard.risk' },
    { path: '/dashboard/analytics', perm: 'view.dashboard.analytics' },
    { path: '/admin/users', perm: 'view.admin.users' },
];
const DashboardRouter: React.FC = () => {
    const { role, permissions } = useSelector((state: RootState) => state.auth);
    const home = role ? HOME_BY_ROLE[role] : undefined;
    if (home && (!home.perm || permissions.includes(home.perm))) return <Navigate to={home.path} replace />;
    const fb = DASHBOARD_FALLBACKS.find((f) => permissions.includes(f.perm));
    return <Navigate to={fb ? fb.path : '/admin/flags'} replace />;  // «Настройка» доступна всем (view.settings)
};

// Гейтинг по ПРАВУ (BL-008). perm — одно право или список (достаточно любого).
const RequirePermission: React.FC<{ perm: string | string[]; children: React.ReactElement }> = ({ perm, children }) => {
    const { permissions } = useSelector((state: RootState) => state.auth);
    const need = Array.isArray(perm) ? perm : [perm];
    return need.some((p) => permissions.includes(p)) ? children : <Navigate to="/dashboard" replace />;
};

export const App: React.FC = () => {
    return (
        <ConfigProvider
            locale={ruRU}
            theme={{
                token: {
                    // Приглушённая, пастельная палитра (менее «кричащие» тона).
                    colorPrimary: '#3A4F6B',
                    colorSuccess: RAG.good.color,
                    colorWarning: RAG.medium.color,
                    colorError: RAG.bad.color,
                    colorInfo: ACCENT.slate.color,
                    // T-57: дефолтный вторичный текст antd — rgba(0,0,0,.45) ≈ 3.05:1 на полотне
                    // дашбордов, ниже WCAG AA. Подписи `type="secondary"` встречаются повсеместно
                    // (счётчики, сноски под графиками), поэтому чиним токеном, а не по местам.
                    colorTextSecondary: BRAND.inkSoft,
                    colorTextDescription: BRAND.inkSoft,
                    colorTextPlaceholder: '#6E7787',
                    // Ссылки/кнопки-ссылки наследуют colorInfo (#6E89A6 = 3.63:1) — поднимаем.
                    colorLink: '#50749B',
                    colorLinkHover: '#3F5F82',
                    colorLinkActive: '#33506F',
                    // Заливку info-Alert antd выводит из приглушённого colorInfo, получается
                    // необычно тёмный тон (#D8E1E6): описание на нём давало 4.40:1. Задаём явно.
                    colorInfoBg: '#EAF0F4',
                },
            }}
        >
            <BrowserRouter>
                <Suspense fallback={<PageLoader />}>
                    <Routes>
                        <Route path="/login" element={<LoginPage />} />
                        <Route path="/*" element={<RequireAuth><AppLayout><Suspense fallback={<PageLoader />}><Routes>
                            <Route path="dashboard" element={<DashboardRouter />} />
                            <Route path="dashboard/analytics" element={<RequirePermission perm="view.dashboard.analytics"><DashboardPage /></RequirePermission>} />
                            <Route path="dashboard/cto" element={<RequirePermission perm="view.dashboard.cto"><CtoDashboard /></RequirePermission>} />
                            <Route path="dashboard/ceo" element={<RequirePermission perm="view.dashboard.ceo"><CeoDashboard /></RequirePermission>} />
                            <Route path="dashboard/risk" element={<RequirePermission perm="view.dashboard.risk"><RiskOwnerDashboard /></RequirePermission>} />
                            {/* Управленческий дашборд — общий алиас (обратная совместимость), доступен CTO/CEO. */}
                            <Route path="dashboard/executive" element={<RequirePermission perm={['view.dashboard.cto', 'view.dashboard.ceo']}><ExecutiveDashboard /></RequirePermission>} />
                            <Route path="dashboard/manager" element={<RequirePermission perm="view.dashboard.manager"><ManagerDashboard /></RequirePermission>} />
                            <Route path="dashboard/manager/dynamics" element={<RequirePermission perm="view.dashboard.dynamics"><QualityDynamicsPage /></RequirePermission>} />
                            <Route path="dashboard/taskplan" element={<RequirePermission perm="view.dashboard.taskplan"><TaskPlanDashboard /></RequirePermission>} />
                            <Route path="dashboard/incidents" element={<RequirePermission perm="view.dashboard.incidents"><IncidentsAnalyticsPage /></RequirePermission>} />
                            <Route path="dashboard/risk-radar" element={<RequirePermission perm="view.dashboard.risk_radar"><RiskRadarPage /></RequirePermission>} />
                            <Route path="assessments/new" element={<RequirePermission perm="view.assessments"><AssessmentWorkspacePage /></RequirePermission>} />
                            {/* ПОД РАЗВИТИЕ: «Оценка СИИ» (ГОСТ Р 59898-2021) — маршрут сохранён, гейтится правом. */}
                            <Route path="ai-assessments" element={<RequirePermission perm="view.ai_assessments"><AiAssessmentPage /></RequirePermission>} />
                            <Route path="assessments/:id/input" element={<RequirePermission perm="view.assessments"><MetricsInputPage /></RequirePermission>} />
                            <Route path="assessments/:id/review" element={<RequirePermission perm="assessment.review"><ExpertReviewPage /></RequirePermission>} />
                            <Route path="reports" element={<RequirePermission perm="view.reports"><ExcelReportsPage /></RequirePermission>} />
                            <Route path="risks" element={<RequirePermission perm="view.risks"><RiskBasePage /></RequirePermission>} />
                            <Route path="risk-economics" element={<RequirePermission perm="view.risk_economics"><RiskEconomicsPage /></RequirePermission>} />
                            <Route path="admin/flags" element={<RequirePermission perm="view.settings"><AdminFlagsPage /></RequirePermission>} />
                            <Route path="admin/users" element={<RequirePermission perm="view.admin.users"><UsersAdminPage /></RequirePermission>} />
                            <Route path="admin/permissions" element={<RequirePermission perm="view.admin.permissions"><PermissionsMatrixPage /></RequirePermission>} />
                            <Route path="admin/llm-quality" element={<RequirePermission perm="view.admin.llm_quality"><LlmQualityPage /></RequirePermission>} />
                            <Route index element={<Navigate to="/dashboard" replace />} />
                        </Routes></Suspense></AppLayout></RequireAuth>} />
                    </Routes>
                </Suspense>
            </BrowserRouter>
        </ConfigProvider>
    );
};

export default App;
