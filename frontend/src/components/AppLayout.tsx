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
    ApartmentOutlined,
    // ExperimentOutlined — под развитие: иконка пункта «Оценка СИИ» (пока не выведен в меню).
} from '@ant-design/icons';
import { useSelector } from 'react-redux';
import { useLocation, useNavigate } from 'react-router-dom';
import { RootState } from '../store';
import { useAppDispatch } from '../store/hooks';
import { logout, setPermissions } from '../store/slices/authSlice';
import { setDataMode, NAV_SECTIONS } from '../store/slices/uiSlice';
import { syncProposals } from '../store/slices/governanceSlice';
import { useGetMyPermissionsQuery, useGetMandatorySectionsQuery } from '../store/api/apiSlice';
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
    // Переключатели опциональных дашбордов из «Настройка» (ТЗ v17, req 5).
    const hiddenSections = useSelector((state: RootState) => state.ui.hiddenSections);
    const navOrder = useSelector((state: RootState) => state.ui.navOrder);
    // ТЗ v20 п.10: разделы, зафиксированные супер-администратором как обязательные для всех —
    // персональное скрытие (hiddenSections) их не должно затрагивать.
    const { data: mandatorySections } = useGetMandatorySectionsQuery();
    const mandatorySet = new Set(mandatorySections?.permissions ?? []);
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
        // Токен обязателен: обход аутентификации выключен по умолчанию (ДЕФ-02).
        const token = localStorage.getItem('token');
        fetch(`${VITE_API}/reports/llm-status`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
        })
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
    const has = (perm: string) => permissions.includes(perm) && (mandatorySet.has(perm) || !hiddenSections[perm]);
    // ДЕФ-12 (БТ-444): пункт виден, если есть ПРАВО и пользователь не скрыл раздел в
    // «Настройка». Раньше флаги действовали только для ADMIN/CTO/CEO — менеджер по качеству
    // щёлкал тумблер, и ничего не происходило. Персонализация — поверх RBAC, а не вместо:
    // право остаётся верхней границей.
    //
    // ДЕФ-11 (БТ-038, T-25): группы названы как в ТЗ — «Основное», «Сбор и анализ данных»,
    // «Формирование техдолга».
    // ДЕФ-14 (БТ-445): порядок внутри группы задаёт пользователь перетаскиванием; ключи, для
    // которых порядок не задан, идут следом в исходном порядке NAV_SECTIONS.
    //
    // Единый источник состава — NAV_SECTIONS (uiSlice): и меню, и экран настроек читают
    // ОДИН список, поэтому «есть тумблер, но нет пункта» стало невозможным по построению.
    const ROUTE_BY_PERM: Record<string, string> = {
        'view.dashboard.cto': '/dashboard/cto',
        'view.dashboard.ceo': '/dashboard/ceo',
        'view.dashboard.manager': '/dashboard/manager',
        'view.dashboard.risk': '/dashboard/risk',
        'view.dashboard.analytics': '/dashboard/analytics',
        'view.dashboard.dynamics': '/dashboard/manager/dynamics',
        'view.assessments': '/assessments/new',
        'view.dashboard.incidents': '/dashboard/incidents',
        'view.risks': '/risks',
        'view.risk_economics': '/risk-economics',
        'view.reports': '/reports',
        'view.dashboard.taskplan': '/dashboard/taskplan',
        'view.my_tasks': '/my-tasks',
        'view.dashboard.risk_radar': '/dashboard/risk-radar',
    };
    const ICON_BY_PERM: Record<string, React.ReactNode> = {
        'view.dashboard.cto': <FundOutlined />,
        'view.dashboard.ceo': <FundOutlined />,
        'view.dashboard.manager': <HomeOutlined />,
        'view.dashboard.risk': <SafetyCertificateOutlined />,
        'view.dashboard.analytics': <DashboardOutlined />,
        'view.dashboard.dynamics': <LineChartOutlined />,
        'view.assessments': <FormOutlined />,
        'view.dashboard.incidents': <ThunderboltOutlined />,
        'view.risks': <WarningOutlined />,
        'view.risk_economics': <AuditOutlined />,
        'view.reports': <FileExcelOutlined />,
        'view.dashboard.taskplan': <ScheduleOutlined />,
        'view.my_tasks': <ScheduleOutlined />,
        'view.dashboard.risk_radar': <AlertOutlined />,
    };
    const mi = (key: string, icon: React.ReactNode, label: string) => ({ key, icon, label });
    const group = (label: string, children: Array<{ key: string; icon: React.ReactNode; label: string }>) =>
        children.length ? [{ type: 'group' as const, label: collapsed ? undefined : groupLabel(label), children }] : [];

    const orderIndex = (perm: string) => {
        const i = navOrder.indexOf(perm);
        return i < 0 ? Number.MAX_SAFE_INTEGER : i;
    };
    const itemsOfGroup = (groupName: string) => NAV_SECTIONS
        .filter((sec) => sec.group === groupName && has(sec.perm))
        .slice()
        .sort((a, b) => orderIndex(a.perm) - orderIndex(b.perm))
        .map((sec) => mi(ROUTE_BY_PERM[sec.perm], ICON_BY_PERM[sec.perm], sec.label));

    const mainItems = itemsOfGroup('Основное');
    const dataItems = itemsOfGroup('Сбор и анализ данных');
    const techDebtItems = itemsOfGroup('Формирование техдолга');
    const adminItems = [
        ...(has('view.admin.users') ? [mi('/admin/users', <TeamOutlined />, 'Пользователи')] : []),
        ...(has('view.admin.permissions') ? [mi('/admin/permissions', <SafetyOutlined />, 'Права')] : []),
        // ТЗ v19 §17.3 (УК-47): справочник направлений — тот же уровень доступа, что и правка прав (В-58).
        ...(has('admin.permissions.manage') ? [mi('/admin/measure-departments', <ApartmentOutlined />, 'Направления')] : []),
        // Пункт виден только суперадминистратору: право view.admin.llm_quality исключительное
        // и матрицей другим ролям не выдаётся (ТЗ v18 п.10).
        ...(has('view.admin.llm_quality') ? [mi('/admin/llm-quality', <ExperimentOutlined />, 'Качество LLM')] : []),
    ];
    const settingsItems = has('view.settings') ? [mi('/admin/flags', <SettingOutlined />, 'Настройка')] : [];

    const menuItems = [
        ...group('Основное', mainItems),
        ...group('Сбор и анализ данных', dataItems),
        ...group('Формирование техдолга', techDebtItems),
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
