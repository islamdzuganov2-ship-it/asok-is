import React, { useState } from 'react';
import { Button, Dropdown, Layout, Menu, Typography } from 'antd';
import {
    DashboardOutlined,
    FormOutlined,
    LogoutOutlined,
    SettingOutlined,
    UserOutlined,
} from '@ant-design/icons';
import { useDispatch, useSelector } from 'react-redux';
import { useLocation, useNavigate } from 'react-router-dom';
import { RootState } from '../store';
import { logout } from '../store/slices/authSlice';

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
    const userRole = role || 'GUEST';

    const menuItems = [
        { key: '/dashboard', icon: <DashboardOutlined />, label: 'Дашборд' },
        ...(['TEST_ANALYST', 'QUALITY_MANAGER', 'ADMIN'].includes(userRole)
            ? [{ key: '/assessments/new', icon: <FormOutlined />, label: 'Новая оценка' }]
            : []),
        ...(userRole === 'ADMIN'
            ? [{ key: '/admin/flags', icon: <SettingOutlined />, label: 'Настройки' }]
            : []),
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
                    <Dropdown menu={userMenu} placement="bottomRight">
                        <Button type="text" icon={<UserOutlined />}>
                            {fullName || 'Пользователь'} ({userRole})
                        </Button>
                    </Dropdown>
                </Header>
                <Content style={{ margin: 24, background: '#fff', borderRadius: 8, padding: 24, minHeight: 280 }}>
                    {children}
                </Content>
            </Layout>
        </Layout>
    );
};
