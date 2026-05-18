/**
 * Корпоративный Layout приложения (Оболочка).
 * Включает боковую панель навигации (Sider), зависящую от роли пользователя, 
 * и верхнюю панель (Header) с профилем и кнопкой выхода.
 */
import React, { useState } from 'react';
import { Layout, Menu, Button, Typography, Dropdown, Space } from 'antd';
import { 
    DashboardOutlined, 
    FormOutlined, 
    SafetyCertificateOutlined, 
    SettingOutlined,
    UserOutlined,
    LogoutOutlined
} from '@ant-design/icons';
import { useNavigate, useLocation } from 'react-router-dom';

const { Header, Sider, Content } = Layout;
const { Title, Text } = Typography;

interface AppLayoutProps {
    children: React.ReactNode;
}

export const AppLayout: React.FC<AppLayoutProps> = ({ children }) => {
    const [collapsed, setCollapsed] = useState(false);
    const navigate = useNavigate();
    const location = useLocation();
    
    // В реальном приложении получаем из Redux (authSlice)
    const role = localStorage.getItem('role') || 'ANALYST'; 
    const userName = localStorage.getItem('full_name') || 'Пользователь';

    /**
     * Динамическое формирование меню на основе Role-Based Access Control (RBAC).
     */
    const menuItems = [
        { key: '/dashboard', icon: <DashboardOutlined />, label: 'Дашборд' },
        // Пункты для Аналитика и Менеджера
        ...(role !== 'GUEST' ? [
            { key: '/assessments/new', icon: <FormOutlined />, label: 'Новая оценка' },
        ] : []),
        // Пункты строго для Менеджера по качеству и Админа
        ...(['QUALITY_MANAGER', 'ADMIN'].includes(role) ? [
            { key: '/assessments/review', icon: <SafetyCertificateOutlined />, label: 'Экспертиза' },
        ] : []),
        // Админ-панель
        ...(role === 'ADMIN' ? [
            { key: '/admin/flags', icon: <SettingOutlined />, label: 'Настройки' },
        ] : []),
    ];

    const handleLogout = () => {
        localStorage.clear();
        navigate('/login');
    };

    const userMenu = {
        items: [
            { key: 'logout', danger: true, icon: <LogoutOutlined />, label: 'Выйти', onClick: handleLogout }
        ]
    };

    return (
        <Layout style={{ minHeight: '100vh' }}>
            <Sider collapsible collapsed={collapsed} onCollapse={(value) => setCollapsed(value)} theme="dark" width={240}>
                <div style={{ height: 32, margin: 16, background: 'rgba(255, 255, 255, 0.2)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Text strong style={{ color: 'white' }}>{!collapsed ? 'АСОК ИС' : 'АСОК'}</Text>
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
                            {userName} ({role})
                        </Button>
                    </Dropdown>
                </Header>
                <Content style={{ margin: '24px', background: '#fff', borderRadius: 8, padding: 24, minHeight: 280 }}>
                    {children}
                </Content>
            </Layout>
        </Layout>
    );
};