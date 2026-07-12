import React, { useEffect, useState } from 'react';
import { Badge, Button, Dropdown, Layout, Menu, Switch, Tooltip, Typography } from 'antd';
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
    // ExperimentOutlined — под развитие: иконка пункта «Оценка СИИ» (пока не выведен в меню).
} from '@ant-design/icons';
import { useSelector } from 'react-redux';
import { useLocation, useNavigate } from 'react-router-dom';
import { RootState } from '../store';
import { useAppDispatch } from '../store/hooks';
import { logout } from '../store/slices/authSlice';
import { setDataMode } from '../store/slices/uiSlice';
import { syncProposals } from '../store/slices/governanceSlice';
import { roleLabel } from '../constants/roles';
import NotificationBell from './NotificationBell';
import { PREMIUM, GOLD } from '../theme/premium';
import { BRAND } from '../theme/ragPalette';

// Приглушённый заголовок группы меню (капитель/трекинг) — премиум, не «кричащий».
const groupLabel = (text: string) => (
    <span style={{ fontSize: 10.5, letterSpacing: 1.4, textTransform: 'uppercase', color: 'rgba(233,220,190,0.55)', fontWeight: 600 }}>{text}</span>
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
    const { role, fullName } = useSelector((state: RootState) => state.auth);
    const dataMode = useSelector((state: RootState) => state.ui.dataMode);
    const { execAnalytics, execDynamics, execTaskPlan, execIncidents } = useSelector((state: RootState) => state.ui);
    const userRole = role || 'GUEST';

    // Синхронизация мер governance из БД при live-режиме (T-10): петля работает между ролями и
    // устройствами (меры/решения/эскалации — на бэкенде). В mock — локальный демо-набор.
    useEffect(() => {
        dispatch(syncProposals());
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

    // Ролевые меню. C-level/ADMIN — управленческий слой; менеджер/аналитик — операционный.
    const isExec = ['CTO', 'CEO', 'CIO', 'EXECUTIVE', 'ADMIN'].includes(userRole);
    const isManager = userRole === 'QUALITY_MANAGER';

    // Топ-менеджер: всегда «Управленческий дашборд» + «Настройка»; остальные борды — по галочке в настройках.
    const execMenu = [
        { key: '/dashboard/executive', icon: <FundOutlined />, label: 'Управленческий дашборд' },
        ...(execAnalytics ? [{ key: '/dashboard/analytics', icon: <DashboardOutlined />, label: 'Аналитический дашборд' }] : []),
        ...(execDynamics ? [{ key: '/dashboard/manager/dynamics', icon: <LineChartOutlined />, label: 'Динамика качества' }] : []),
        ...(execTaskPlan ? [{ key: '/dashboard/taskplan', icon: <ScheduleOutlined />, label: 'План задач' }] : []),
        ...(execIncidents ? [
            { key: '/dashboard/incidents', icon: <ThunderboltOutlined />, label: 'Аналитика сбоев' },
            { key: '/dashboard/risk-radar', icon: <AlertOutlined />, label: 'Риск-радар' },
        ] : []),
        { key: '/admin/flags', icon: <SettingOutlined />, label: 'Настройка' },
    ];
    // ПОД РАЗВИТИЕ: раздел «Оценка СИИ» (ГОСТ Р 59898-2021) и история ИИ-оценок пока НЕ выведены
    // в интерфейс (страница и маршрут /ai-assessments сохранены в коде — см. App.tsx). Когда
    // раздел понадобится, добавить сюда пункт меню:
    //   { key: '/ai-assessments', icon: <ExperimentOutlined />, label: 'Оценка СИИ' }
    // Логичная группировка меню МК (ТЗ v15, T-25): Основное · Сбор и анализ данных ·
    // Формирование тех. долга. Заголовки групп скрываются при сворачивании сайдбара.
    const managerMenu = [
        {
            type: 'group' as const, label: collapsed ? undefined : groupLabel('Основное'),
            children: [{ key: '/dashboard/manager', icon: <HomeOutlined />, label: 'Основное' }],
        },
        {
            type: 'group' as const, label: collapsed ? undefined : groupLabel('Сбор и анализ данных'),
            children: [
                { key: '/assessments/new', icon: <FormOutlined />, label: 'Внесение данных' },
                { key: '/dashboard/analytics', icon: <DashboardOutlined />, label: 'Аналитический дашборд' },
                { key: '/dashboard/manager/dynamics', icon: <LineChartOutlined />, label: 'Динамика качества' },
                { key: '/dashboard/incidents', icon: <ThunderboltOutlined />, label: 'Аналитика сбоев' },
                { key: '/risks', icon: <WarningOutlined />, label: 'База рисков' },
                { key: '/dashboard/risk-radar', icon: <AlertOutlined />, label: 'Риск-радар' },
            ],
        },
        {
            type: 'group' as const, label: collapsed ? undefined : groupLabel('Формирование тех. долга'),
            children: [{ key: '/dashboard/taskplan', icon: <ScheduleOutlined />, label: 'План задач' }],
        },
    ];
    const analystMenu = [
        { key: '/dashboard/analytics', icon: <DashboardOutlined />, label: 'Аналитический дашборд' },
        { key: '/assessments/new', icon: <FormOutlined />, label: 'Внесение данных' },
        { key: '/risks', icon: <WarningOutlined />, label: 'База рисков' },
    ];

    const menuItems = isExec ? execMenu : isManager ? managerMenu : analystMenu;

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
            <Sider
                collapsible collapsed={collapsed} onCollapse={setCollapsed} theme="dark" width={244}
                style={{ background: PREMIUM.gradient.sider, boxShadow: '2px 0 24px -12px rgba(16,24,40,0.45)' }}
            >
                {/* Премиальный логотип: графит-плашка с золотым акцентом */}
                <div style={{ height: 56, margin: '16px 14px 10px', display: 'flex', alignItems: 'center', gap: 11, justifyContent: collapsed ? 'center' : 'flex-start' }}>
                    <div style={{ width: 32, height: 32, borderRadius: 9, background: PREMIUM.gradient.ink, border: `1px solid ${GOLD.line}`, boxShadow: `0 0 0 3px ${GOLD.glow}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>
                        <span style={{ color: GOLD.soft, fontWeight: 800, fontSize: 14 }}>А</span>
                    </div>
                    {!collapsed && (
                        <div style={{ lineHeight: 1.15 }}>
                            <div style={{ color: '#fff', fontWeight: 700, letterSpacing: 1.2, fontSize: 15 }}>АСОК ИС</div>
                            <div style={{ color: 'rgba(233,220,190,0.6)', fontSize: 9.5, letterSpacing: 1.8, textTransform: 'uppercase' }}>оценка качества</div>
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
                <Header style={{ padding: '0 24px', background: PREMIUM.gradient.header, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${PREMIUM.border}`, boxShadow: '0 1px 4px rgba(0,21,41,.06)', zIndex: 1 }}>
                    <Title level={4} style={{ margin: 0, color: BRAND.ink, letterSpacing: 0.3, fontWeight: 700 }}>Система оценки качества</Title>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                        <Tooltip title={`${llmStatusText}. Переключатель источника данных дашбордов.`}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <Badge color={llmStatusColor} />
                                <RobotOutlined style={{ color: dataMode === 'live' ? '#1F3864' : '#bbb' }} />
                                <Text type="secondary" style={{ fontSize: 12 }}>Демо</Text>
                                <Switch
                                    size="small"
                                    checked={dataMode === 'live'}
                                    onChange={(v) => dispatch(setDataMode(v ? 'live' : 'mock'))}
                                />
                                <Text type="secondary" style={{ fontSize: 12 }}>LLM</Text>
                            </div>
                        </Tooltip>
                        <NotificationBell />
                        <Dropdown menu={userMenu} placement="bottomRight">
                            <Button type="text" icon={<UserOutlined />}>
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
