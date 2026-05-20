import React, { useState } from 'react';
import { Button, Card, Form, Input, Layout, Typography, message } from 'antd';
import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { setCredentials } from '../store/slices/authSlice';

const { Title, Text } = Typography;

interface LoginResponse {
    access_token: string;
    role: string;
    full_name?: string;
}

export const LoginPage: React.FC = () => {
    const navigate = useNavigate();
    const dispatch = useDispatch();
    const [loading, setLoading] = useState(false);

    const onFinish = async (values: { username: string; password: string }) => {
        setLoading(true);
        try {
            const response = await fetch(
                `${import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v1'}/auth/login`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(values),
                },
            );
            if (!response.ok) {
                throw new Error('Login failed');
            }

            const data = (await response.json()) as LoginResponse;
            dispatch(
                setCredentials({
                    token: data.access_token,
                    role: data.role,
                    fullName: data.full_name || values.username,
                }),
            );
            message.success('Успешный вход в систему');
            navigate('/dashboard', { replace: true });
        } catch {
            message.error('Ошибка авторизации. Проверьте логин и пароль.');
        } finally {
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

                <Form name="login_form" onFinish={onFinish} size="large">
                    <Form.Item name="username" rules={[{ required: true, message: 'Введите имя пользователя' }]}>
                        <Input prefix={<UserOutlined />} placeholder="admin / analyst / manager" />
                    </Form.Item>

                    <Form.Item name="password" rules={[{ required: true, message: 'Введите пароль' }]}>
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
