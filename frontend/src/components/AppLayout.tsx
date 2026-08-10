import React, { useEffect, useState } from 'react';
import { Badge, Button, Dropdown, Layout, Menu, Spin, Switch, Tooltip, Typography } from 'antd';
import {
    DashboardOutlined,
    FormOutlined,
    LogoutOutlined,
    SettingOutlined,
    FileExcelOutlined,
    UserOutlined,
    FundOutlined,
    AuditOutlined,
    WarningOutlined,
    RobotOutlined,
    LineChartOutlined,
    ScheduleOutlined,
    HomeOutlined,
    ThunderboltOutlined,
    AlertOutlined,
    TeamOutlined,
    SafetyOutlined,
    ExperimentOutlined,
    SafetyCertificateOutlined,
    // ExperimentOutlined — под развитие: иконка пункта «Оценка СИИ» (пока не выведен в меню).
} from '@ant-design/icons';
import { useSelector } from 'react-redux';
import { useLocation, useNavigate } from 'react-router-dom';
import { RootState } from '../store';
import { useAppDispatch } from '../store/hooks';
import { logout, setPermissions } from '../store/slices/authSlice';
import { setDataMode } from '../store/slices/uiSlice';
import { syncProposals } from '../store/slices/governanceSlice';
import { useGetMyPermissionsQuery } from '../store/api/apiSlice';
import { roleLabel } from '../constants/roles';
import NotificationBell from './NotificationBell';
import { PREMIUM, GOLD, TYPE, SPACE } from '../theme/premium';
import { BRAND } from '../theme/ragPalette';

// Приглушённый заголовок группы меню (капитель/трекинг) — премиум, не «кричащий».
// Альфа 0.7 (было 0.55): на самом светлом стопе градиента сайдбара 0.55 давало 3.84:1 —
// ниже WCAG AA для 10.5px (T-57). Приглушённость сохраняется, читаемость — нет.
const groupLabel = (text: string) => (
    <span style={{ ...TYPE.micro, fontWeight: 600, letterSpacing: 1.4, textTransform: 'uppercase', color: 'rgba(233,220,190,0.7)' }}>{text}</span>
);

const VITE_API = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api/v1';

const { Header, Sider, Content } = Layout;
const { Title, Text } = Typography;

interface AppLayoutProps {
    children: React.ReactNode;
}

export const AppLayout: React.FC<AppLayoutProps> = ({ children }) => {
    const [collapsed, setCollapsed] = useState(false);
    const navigate = useNavigate();
    const location = useLocation();
    const dispatch = useAppDispatch();
    const { role, fullName, permissions, permissionsLoaded } = useSelector((state: RootState) => state.auth);
    const dataMode = useSelector((state: RootState) => state.ui.dataMode);
    const userRole = role || 'GUEST';

    // Права пользователя (BL-008): грузим с сервера и кладём в стор (обновляются и при возврате
    // во вкладку — refetchOnFocus в apiSlice), чтобы правки супер-админа применялись без F5.
    const { data: myPerms } = useGetMyPermissionsQuery(undefined, { skip: !role });
    useEffect(() => { if (myPerms) dispatch(setPermissions(myPerms.permissions)); }, [myPerms, dispatch]);

    // Синхронизация мер governance из БД при live-режиме (T-10): петля работает между ролями и
    // устройствами (меры/решения/эскалации — на бэкенде). В mock — локальный демо-набор.
    // Дополнительно ре-синхронизируем при возврате во вкладку (focus) — чтобы меры/статусы
    // обновлялись без ручного F5 (жалоба «нет авто-сброса кэша»). В mock thunk — no-op.
    useEffect(() => {
        dispatch(syncProposals());
        const onFocus = () => dispatch(syncProposals());
        window.addEventListener('focus', onFocus);
        return () => window.removeEventListener('focus', onFocus);
    }, [dataMode, dispatch]);

    // Статус встроенной LLM (для индикатора рядом с переключателем): готовность + паспорт модели.
    const [llmReady, setLlmReady] = useState<boolean | null>(null);
    const [llmStatus, setLlmStatus] = useState<any>(null);
    useEffect(() => {
        let alive = true;
        fetch(`${VITE_API}/reports/llm-status`)
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => { if (alive) { setLlmStatus(d); setLlmReady(d ? !!d.available : false); } })
            .catch(() => { if (alive) { setLlmStatus(null); setLlmReady(false); } });
        return () => { alive = false; };
    }, [dataMode]);

    const prof = llmStatus?.profile;
    const modelDesc = prof
        ? `${prof.name || prof.file_name}${prof.architecture ? ` · ${prof.architecture}` : ''} · ${prof.n_gpu_layers ? 'GPU' : 'CPU'}`
        : '';
    const llmStatusColor = llmReady === null ? 'default' : llmReady ? 'green' : 'gold';
    const llmStatusText = llmReady === null
        ? 'Проверка LLM…'
        : llmReady ? `LLM загружена: ${modelDesc || 'модель'}` : 'LLM не загружена — будет честный fallback';

    // До загрузки прав пользователя — экран-заглушка (гейтинг маршрутов зависит от permissions).
    if (!permissionsLoaded) {
        return (
            <div style={{
                display: 'flex', flexDirection: 'column', gap: SPACE.cozy,
                justifyContent: 'center', alignItems: 'center', height: '100vh',
                background: PREMIUM.gradient.canvas,
            }}>
                <Spin size="large" />
                <span style={{ ...TYPE.caption, color: BRAND.inkSoft }}>Загрузка прав доступа…</span>
            </div>
        );
    }

    // Меню строится ПО ПРАВАМ (BL-008): пункт виден, если у роли есть указанное право.
    // Раньше меню ветвилось по роли (isExec/isManager) — теперь состав задаёт матрица прав,
    // которую супер-админ настраивает в разделе «Права». Оценка СИИ (view.ai_assessments) в меню
    // намеренно не выводится (раздел под развитие), но маршрут доступен по праву.
    const has = (perm: string) => permissions.includes(perm);
    const mi = (key: string, icon: React.ReactNode, label: string) => ({ key, icon, label });
    const group = (label: string, children: Array<{ key: string; icon: React.ReactNode; label: string }>) =>
        children.length ? [{ type: 'group' as const, label: collapsed ? undefined : groupLabel(label), children }] : [];

    const dashboards = [
        ...(has('view.dashboard.cto') ? [mi('/dashboard/cto', <FundOutlined />, 'Дашборд CTO')] : []),
        ...(has('view.dashboard.ceo') ? [mi('/dashboard/ceo', <FundOutlined />, 'Дашборд CEO')] : []),
        ...(has('view.dashboard.manager') ? [mi('/dashboard/manager', <HomeOutlined />, 'Основное')] : []),
        ...(has('view.dashboard.risk') ? [mi('/dashboard/risk', <SafetyCertificateOutlined />, 'Основное — риск')] : []),
        ...(has('view.dashboard.analytics') ? [mi('/dashboard/analytics', <DashboardOutlined />, 'Аналитический дашборд')] : []),
        ...(has('view.dashboard.dynamics') ? [mi('/dashboard/manager/dynamics', <LineChartOutlined />, 'Динамика качества')] : []),
        ...(has('view.dashboard.incidents') ? [mi('/dashboard/incidents', <ThunderboltOutlined />, 'Аналитика сбоев')] : []),
        ...(has('view.dashboard.risk_radar') ? [mi('/dashboard/risk-radar', <AlertOutlined />, 'Риск-радар')] : []),
        ...(has('view.dashboard.taskplan') ? [mi('/dashboard/taskplan', <ScheduleOutlined />, 'План задач')] : []),
    ];
    const sections = [
        ...(has('view.assessments') ? [mi('/assessments/new', <FormOutlined />, 'Внесение данных')] : []),
        ...(has('view.risks') ? [mi('/risks', <WarningOutlined />, 'База рисков')] : []),
        ...(has('view.risk_economics') ? [mi('/risk-economics', <AuditOutlined />, 'Риск-экономика')] : []),
        ...(has('view.reports') ? [mi('/reports', <FileExcelOutlined />, 'Отчёты')] : []),
    ];
    const adminItems = [
        ...(has('view.admin.users') ? [mi('/admin/users', <TeamOutlined />, 'Пользователи')] : []),
        ...(has('view.admin.permissions') ? [mi('/admin/permissions', <SafetyOutlined />, 'Права')] : []),
        // Пункт виден только суперадминистратору: право view.admin.llm_quality исключительное
        // и матрицей другим ролям не выдаётся (ТЗ v18 п.10).
        ...(has('view.admin.llm_quality') ? [mi('/admin/llm-quality', <ExperimentOutlined />, 'Качество LLM')] : []),
    ];
    const settingsItems = has('view.settings') ? [mi('/admin/flags', <SettingOutlined />, 'Настройка')] : [];

    const menuItems = [
        ...group('Дашборды', dashboards),
        ...group('Сбор и анализ данных', sections),
        ...group('Администрирование', adminItems),
        ...settingsItems,
    ];

    const handleLogout = () => {
        dispatch(logout());
        navigate('/login');
    };

    const userMenu = {
        items: [
            { key: 'logout', danger: true, icon: <LogoutOutlined />, label: 'Выйти', onClick: handleLogout },
        ],
    };

    return (
        <Layout style={{ minHeight: '100vh' }}>
            {/* `breakpoint` — сайдбар сам сворачивается на узком экране. Без него 244px были
                фиксированы всегда: на 375px под контент оставалось 131px, и КАЖДАЯ страница
                уезжала вбок на ~450px. Причина была не в контенте, а здесь (UI-13). */}
            <Sider
                collapsible collapsed={collapsed} onCollapse={setCollapsed} theme="dark" width={244}
                breakpoint="lg" collapsedWidth={56}
                style={{ background: PREMIUM.gradient.sider, boxShadow: '2px 0 24px -12px rgba(16,24,40,0.45)' }}
            >
                {/* Премиальный логотип: графит-плашка с золотым акцентом */}
                <div style={{ height: 56, margin: `${SPACE.base}px ${SPACE.base}px ${SPACE.cozy}px`, display: 'flex', alignItems: 'center', gap: SPACE.cozy, justifyContent: collapsed ? 'center' : 'flex-start' }}>
                    <div style={{ width: 32, height: 32, borderRadius: 9, background: PREMIUM.gradient.ink, border: `1px solid ${GOLD.line}`, boxShadow: `0 0 0 3px ${GOLD.glow}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>
                        <span style={{ color: GOLD.soft, fontWeight: 800, fontSize: TYPE.body.fontSize }}>А</span>
                    </div>
                    {!collapsed && (
                        <div style={{ lineHeight: 1.15 }}>
                            <div style={{ ...TYPE.cardTitle, color: '#fff', fontWeight: 700, letterSpacing: 1.2 }}>АСОК ИС</div>
                            <div style={{ ...TYPE.micro, fontWeight: 400, color: 'rgba(233,220,190,0.7)', letterSpacing: 1.8, textTransform: 'uppercase' }}>оценка качества</div>
                        </div>
                    )}
                </div>
                <div style={{ height: 1, margin: '0 16px 6px', background: PREMIUM.gradient.goldLine }} />
                <Menu
                    theme="dark"
                    mode="inline"
                    selectedKeys={[location.pathname]}
                    items={menuItems}
                    onClick={({ key }) => navigate(key)}
                    style={{ background: 'transparent', borderInlineEnd: 'none' }}
                />
            </Sider>
            <Layout style={{ background: PREMIUM.gradient.canvas }}>
                {/* Шапка не сжималась: заголовок и блок пользователя вместе требовали ~637px,
                    из-за чего на 375px КАЖДАЯ страница уезжала вбок на 262px даже при
                    свёрнутом сайдбаре. Заголовок теперь ужимается, имя — с многоточием (UI-13). */}
                <Header style={{ padding: `0 ${SPACE.page}px`, background: PREMIUM.gradient.header, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: SPACE.base, borderBottom: `1px solid ${PREMIUM.border}`, boxShadow: '0 1px 4px rgba(0,21,41,.06)', zIndex: 1 }}>
                    <Title
                        level={4}
                        style={{
                            ...TYPE.pageTitle, margin: 0, color: BRAND.ink, letterSpacing: 0.3,
                            minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}
                    >
                        Система оценки качества
                    </Title>
                    <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.base, minWidth: 0, flex: '0 1 auto' }}>
                        <Tooltip title={`${llmStatusText}. Переключатель источника данных дашбордов.`}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.snug, flex: '0 0 auto' }}>
                                <Badge color={llmStatusColor} />
                                <RobotOutlined style={{ color: dataMode === 'live' ? BRAND.ink : BRAND.inkSoft }} />
                                <Text type="secondary" className="header-mode-label" style={TYPE.caption}>Демо</Text>
                                <Switch
                                    size="small"
                                    checked={dataMode === 'live'}
                                    onChange={(v) => dispatch(setDataMode(v ? 'live' : 'mock'))}
                                />
                                <Text type="secondary" className="header-mode-label" style={TYPE.caption}>LLM</Text>
                            </div>
                        </Tooltip>
                        <NotificationBell />
                        <Dropdown menu={userMenu} placement="bottomRight">
                            <Button
                                type="text"
                                icon={<UserOutlined />}
                                // Имя+роль — самый длинный элемент шапки; ужимаем его, а не вьюпорт.
                                style={{ maxWidth: 'min(220px, 34vw)', overflow: 'hidden', textOverflow: 'ellipsis' }}
                            >
                                {fullName || 'Пользователь'} · {roleLabel(userRole)}
                            </Button>
                        </Dropdown>
                    </div>
                </Header>
                <Content style={{ margin: 0, background: 'transparent', padding: 24, minHeight: 'calc(100vh - 64px)' }}>
                    {children}
                </Content>
            </Layout>
        </Layout>
    );
};
