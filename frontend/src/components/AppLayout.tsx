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
} from '@ant-design/icons';
import { useDispatch, useSelector } from 'react-redux';
import { useLocation, useNavigate } from 'react-router-dom';
import { RootState } from '../store';
import { logout } from '../store/slices/authSlice';
import { setDataMode } from '../store/slices/uiSlice';
import { roleLabel } from '../constants/roles';

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
    const dispatch = useDispatch();
    const { role, fullName } = useSelector((state: RootState) => state.auth);
    const dataMode = useSelector((state: RootState) => state.ui.dataMode);
    const userRole = role || 'GUEST';

    // Статус встроенной LLM (для индикатора рядом с переключателем)
    const [llmReady, setLlmReady] = useState<boolean | null>(null);
    useEffect(() => {
        let alive = true;
        fetch(`${VITE_API}/reports/llm-status`)
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => { if (alive) setLlmReady(d ? !!d.available : false); })
            .catch(() => { if (alive) setLlmReady(false); });
        return () => { alive = false; };
    }, [dataMode]);

    const llmStatusColor = llmReady === null ? 'default' : llmReady ? 'green' : 'gold';
    const llmStatusText = llmReady === null
        ? 'Проверка LLM…'
        : llmReady ? 'LLM загружена и готова' : 'LLM не загружена — будет честный fallback';

    // Ролевые меню. C-level/ADMIN — управленческий слой; менеджер/аналитик — операционный.
    const isExec = ['CTO', 'CEO', 'CIO', 'EXECUTIVE', 'ADMIN'].includes(userRole);
    const isManager = userRole === 'QUALITY_MANAGER';

    const execMenu = [
        { key: '/dashboard/executive', icon: <FundOutlined />, label: 'Управленческий дашборд' },
        { key: '/dashboard/analytics', icon: <DashboardOutlined />, label: 'Аналитический дашборд' },
        { key: '/admin/flags', icon: <SettingOutlined />, label: 'Настройка' },
    ];
    const managerMenu = [
        { key: '/dashboard/manager', icon: <AuditOutlined />, label: 'Менеджер по качеству' },
        { key: '/dashboard/manager/dynamics', icon: <LineChartOutlined />, label: 'Динамика качества' },
        { key: '/dashboard/analytics', icon: <DashboardOutlined />, label: 'Аналитический дашборд' },
        { key: '/assessments/new', icon: <FormOutlined />, label: 'Оценка ИС' },
        { key: '/risks', icon: <WarningOutlined />, label: 'База рисков' },
    ];
    const analystMenu = [
        { key: '/dashboard/analytics', icon: <DashboardOutlined />, label: 'Аналитический дашборд' },
        { key: '/assessments/new', icon: <FormOutlined />, label: 'Оценка ИС' },
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
            <Sider collapsible collapsed={collapsed} onCollapse={setCollapsed} theme="dark" width={240}>
                <div style={{ height: 32, margin: 16, background: 'rgba(255,255,255,0.2)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Text strong style={{ color: 'white' }}>{collapsed ? 'АСОК' : 'АСОК ИС'}</Text>
                </div>
                <Menu
                    theme="dark"
                    mode="inline"
                    selectedKeys={[location.pathname]}
                    items={menuItems}
                    onClick={({ key }) => navigate(key)}
                />
            </Sider>
            <Layout>
                <Header style={{ padding: '0 24px', background: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 1px 4px rgba(0,21,41,.08)', zIndex: 1 }}>
                    <Title level={4} style={{ margin: 0, color: '#1F3864' }}>Система оценки качества</Title>
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
                        <Dropdown menu={userMenu} placement="bottomRight">
                            <Button type="text" icon={<UserOutlined />}>
                                {fullName || 'Пользователь'} · {roleLabel(userRole)}
                            </Button>
                        </Dropdown>
                    </div>
                </Header>
                <Content style={{ margin: 24, background: '#fff', borderRadius: 8, padding: 24, minHeight: 280 }}>
                    {children}
                </Content>
            </Layout>
        </Layout>
    );
};
