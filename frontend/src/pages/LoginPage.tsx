/**
 * Экран аутентификации.
 * Обеспечивает вход в систему, получение JWT токена и инициализацию ролевой модели.
 */
import React, { useState } from 'react';
import { Form, Input, Button, Card, Typography, message, Layout } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
// В реальном проекте используем мутацию RTK Query:
// import { useLoginMutation } from '../store/api/authApi';

const { Title, Text } = Typography;

export const LoginPage: React.FC = () => {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(false);
    // const [loginMutation] = useLoginMutation();

    /**
     * Обработчик отправки формы логина.
     */
    const onFinish = async (values: any) => {
        setLoading(true);
        try {
            // Имитация API вызова. Заменить на:
            // const response = await loginMutation(values).unwrap();
            // localStorage.setItem('token', response.access_token);
            // localStorage.setItem('role', response.role);
            
            // Заглушка для демо-режима:
            setTimeout(() => {
                localStorage.setItem('token', 'demo-jwt-token-12345');
                // Присваиваем роль Администратора для тестирования всех экранов
                localStorage.setItem('role', 'ADMIN'); 
                localStorage.setItem('full_name', 'Иванов И.И.');
                
                message.success('Успешный вход в систему');
                navigate('/dashboard', { replace: true });
            }, 800);
            
        } catch (error) {
            message.error('Ошибка авторизации. Проверьте логин и пароль.');
            setLoading(false);
        }
    };

    return (
        <Layout style={{ minHeight: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center', background: '#f0f2f5' }}>
            <Card style={{ width: 400, boxShadow: '0 4px 12px rgba(0,0,0,0.05)', borderRadius: 8 }}>
                <div style={{ textAlign: 'center', marginBottom: 24 }}>
                    <Title level={3} style={{ color: '#1F3864', margin: 0 }}>АСОК ИС</Title>
                    <Text type="secondary">Автоматизированная система оценки качества</Text>
                </div>

                <Form
                    name="login_form"
                    initialValues={{ remember: true }}
                    onFinish={onFinish}
                    size="large"
                >
                    <Form.Item
                        name="username"
                        rules={[{ required: true, message: 'Пожалуйста, введите имя пользователя!' }]}
                    >
                        <Input prefix={<UserOutlined />} placeholder="Имя пользователя (AD / LDAP)" />
                    </Form.Item>

                    <Form.Item
                        name="password"
                        rules={[{ required: true, message: 'Пожалуйста, введите пароль!' }]}
                    >
                        <Input.Password prefix={<LockOutlined />} placeholder="Пароль" />
                    </Form.Item>

                    <Form.Item>
                        <Button type="primary" htmlType="submit" style={{ width: '100%' }} loading={loading}>
                            Войти в систему
                        </Button>
                    </Form.Item>
                </Form>
            </Card>
        </Layout>
    );
};

export default LoginPage;