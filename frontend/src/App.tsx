import React, { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { App as AntdApp, ConfigProvider, Spin } from 'antd';
import ruRU from 'antd/locale/ru_RU';
import { useSelector } from 'react-redux';
import { RootState } from './store';
import { AppLayout } from './components/AppLayout';
import { BRAND } from './theme/ragPalette';
import { SPACE, TYPE } from './theme/premium';
import { THEMES, antdThemeOf, fontStackOf } from './theme/themes';
import { registerAppApi } from './theme/appMessage';

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
const AssigneeTasksPage = lazy(() => import('./pages/AssigneeTasksPage'));
const ExcelReportsPage = lazy(() => import('./pages/ExcelReportsPage'));
const RiskBasePage = lazy(() => import('./pages/RiskBasePage'));
const RiskEconomicsPage = lazy(() => import('./pages/RiskEconomicsPage'));
const UsersAdminPage = lazy(() => import('./pages/admin/UsersAdminPage'));
const PermissionsMatrixPage = lazy(() => import('./pages/admin/PermissionsMatrixPage'));
const LlmQualityPage = lazy(() => import('./pages/admin/LlmQualityPage'));
const MeasureDepartmentsPage = lazy(() => import('./pages/admin/MeasureDepartmentsPage'));

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
    // ДЕФ-10: исполнитель заходит сразу в свои поручения.
    EXECUTOR: { path: '/my-tasks', perm: 'view.my_tasks' },
};
// Порядок «первого доступного» дашборда, если у роли нет своего.
const DASHBOARD_FALLBACKS: Array<{ path: string; perm: string }> = [
    { path: '/dashboard/cto', perm: 'view.dashboard.cto' },
    { path: '/dashboard/ceo', perm: 'view.dashboard.ceo' },
    { path: '/dashboard/manager', perm: 'view.dashboard.manager' },
    { path: '/dashboard/risk', perm: 'view.dashboard.risk' },
    { path: '/dashboard/analytics', perm: 'view.dashboard.analytics' },
    { path: '/my-tasks', perm: 'view.my_tasks' },
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

/**
 * ThemeVarsBridge — проставляет CSS-переменные выбранной темы и шрифта на <html>.
 * Кастомный слой (токены BRAND/PREMIUM на var()) и «сырые» элементы дашбордов перекрашиваются этим;
 * компоненты antd — через ConfigProvider theme ниже. `data-theme` включает точечные правила
 * (color-scheme, скроллбары) из styles/themes.css.
 */
/**
 * AppApiBridge — отдаёт тос­ты/модалки, знающие про тему (ДЕФ-09).
 *
 * Статические `message.*` не видят ConfigProvider и в тёмной теме рисовались светлыми.
 * Компонент живёт ВНУТРИ <App> antd и передаёт его экземпляры в theme/appMessage.ts,
 * откуда их берут все точки вызова.
 */
const AppApiBridge: React.FC = () => {
    const api = AntdApp.useApp();
    useEffect(() => {
        registerAppApi({ message: api.message, notification: api.notification, modal: api.modal });
    }, [api]);
    return null;
};

const ThemeVarsBridge: React.FC = () => {
    const themeName = useSelector((s: RootState) => s.ui.themeName);
    const fontKey = useSelector((s: RootState) => s.ui.fontKey);
    useEffect(() => {
        const root = document.documentElement;
        const preset = THEMES[themeName] ?? THEMES.premium;
        root.dataset.theme = preset.name;
        Object.entries(preset.vars).forEach(([k, v]) => root.style.setProperty(k, v));
        root.style.setProperty('--app-font', fontStackOf(fontKey));
    }, [themeName, fontKey]);
    return null;
};

export const App: React.FC = () => {
    const themeName = useSelector((s: RootState) => s.ui.themeName);
    const fontKey = useSelector((s: RootState) => s.ui.fontKey);
    const preset = THEMES[themeName] ?? THEMES.premium;
    return (
        <ConfigProvider locale={ruRU} theme={antdThemeOf(preset, fontKey)}>
            <ThemeVarsBridge />
            {/* <App> antd даёт тостам и модалкам доступ к теме (ДЕФ-09).
                component по умолчанию ('div') обязателен при cssVar: с component={false}
                antd предупреждает «ensure component is assigned a valid React component». */}
            <AntdApp>
            <AppApiBridge />
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
                            <Route path="my-tasks" element={<RequirePermission perm="view.my_tasks"><AssigneeTasksPage /></RequirePermission>} />
                            <Route path="reports" element={<RequirePermission perm="view.reports"><ExcelReportsPage /></RequirePermission>} />
                            <Route path="risks" element={<RequirePermission perm="view.risks"><RiskBasePage /></RequirePermission>} />
                            <Route path="risk-economics" element={<RequirePermission perm="view.risk_economics"><RiskEconomicsPage /></RequirePermission>} />
                            <Route path="admin/flags" element={<RequirePermission perm="view.settings"><AdminFlagsPage /></RequirePermission>} />
                            <Route path="admin/users" element={<RequirePermission perm="view.admin.users"><UsersAdminPage /></RequirePermission>} />
                            <Route path="admin/permissions" element={<RequirePermission perm="view.admin.permissions"><PermissionsMatrixPage /></RequirePermission>} />
                            <Route path="admin/measure-departments" element={<RequirePermission perm="admin.permissions.manage"><MeasureDepartmentsPage /></RequirePermission>} />
                            <Route path="admin/llm-quality" element={<RequirePermission perm="view.admin.llm_quality"><LlmQualityPage /></RequirePermission>} />
                            <Route index element={<Navigate to="/dashboard" replace />} />
                            {/* ДЕФ-36: неизвестный URL внутри лэйаута рендерил пустую область
                                без единого сообщения. Уводим на посадочную страницу роли. */}
                            <Route path="*" element={<Navigate to="/dashboard" replace />} />
                        </Routes></Suspense></AppLayout></RequireAuth>} />
                    </Routes>
                </Suspense>
            </BrowserRouter>
            </AntdApp>
        </ConfigProvider>
    );
};

export default App;
