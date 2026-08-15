import React, { useState } from 'react';
import { Button, Card, Form, Input, Layout, Typography } from 'antd';
import { message } from '../theme/appMessage';
import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { setCredentials } from '../store/slices/authSlice';
import { premiumCard, PREMIUM, GOLD, TYPE, SPACE } from '../theme/premium';
import { BRAND } from '../theme/ragPalette';

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
        <Layout style={{ minHeight: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center', background: PREMIUM.gradient.canvas }}>
            {/* Первый экран продукта: держим тот же premium-слой и тот же фирменный знак, что
                в сайдбаре, — иначе впечатление «дорого» ломается ещё до входа (UI-01).
                Акцент `premiumCard` красит ШАПКУ, а у этой карточки шапки нет — поэтому золотую
                грань задаём явно сверху, иначе акцент не виден вообще (найдено на скриншоте). */}
            <Card {...premiumCard('gold', {
                width: 400,
                borderTop: `2px solid ${GOLD.base}`,
            })}>
                <div style={{ textAlign: 'center', marginBottom: SPACE.page }}>
                    <div style={{
                        width: 44, height: 44, borderRadius: 12, margin: '0 auto',
                        background: PREMIUM.gradient.ink, border: `1px solid ${GOLD.line}`,
                        boxShadow: `0 0 0 4px ${GOLD.glow}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                        <span style={{ color: GOLD.soft, fontWeight: 800, fontSize: TYPE.metricSm.fontSize }}>А</span>
                    </div>
                    <Title level={3} style={{ ...TYPE.pageTitle, color: BRAND.ink, marginTop: SPACE.cozy, letterSpacing: 1.2 }}>
                        АСОК ИС
                    </Title>
                    <Text type="secondary" style={TYPE.caption}>Автоматизированная система оценки качества</Text>
                </div>

                <Form name="login_form" onFinish={onFinish} size="large">
                    <Form.Item name="username" rules={[{ required: true, message: 'Введите имя пользователя' }]}>
                        <Input prefix={<UserOutlined />} placeholder="Имя пользователя" autoComplete="username" />
                    </Form.Item>

                    <Form.Item name="password" rules={[{ required: true, message: 'Введите пароль' }]}>
                        <Input.Password prefix={<LockOutlined />} placeholder="Пароль" autoComplete="current-password" />
                    </Form.Item>

                    <Form.Item style={{ marginBottom: 0 }}>
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
