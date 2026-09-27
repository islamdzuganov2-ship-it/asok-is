/**
 * ChangePasswordPage — смена собственного пароля (ИБ-11).
 *
 * Два входа: обязательный — после входа временным паролем от администратора (RequireAuth
 * не пускает никуда, кроме этого экрана, сервер отвечает 403 на остальное) и добровольный —
 * пункт «Сменить пароль» в меню пользователя. Успешная смена закрывает все прежние сессии
 * на сервере; ответ несёт новый токен, с ним пользователь продолжает работу без релогина.
 */
import React, { useEffect, useState } from 'react';
import { Alert, Button, Card, Form, Input, Layout, Typography } from 'antd';
import { LockOutlined } from '@ant-design/icons';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { RootState } from '../store';
import { useAppDispatch } from '../store/hooks';
import { logout, passwordChanged } from '../store/slices/authSlice';
import { message } from '../theme/appMessage';
import { premiumCard, PREMIUM, GOLD, TYPE, SPACE } from '../theme/premium';
import { BRAND } from '../theme/ragPalette';
import { serverLogout } from '../utils/serverLogout';
import { RULES_FALLBACK, clientPasswordIssues } from '../utils/passwordPolicy';

const { Title, Text } = Typography;
const API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v1';

interface FormValues {
    current_password: string;
    new_password: string;
    confirm: string;
}

export const ChangePasswordPage: React.FC = () => {
    const navigate = useNavigate();
    const dispatch = useAppDispatch();
    const { token, mustChangePassword } = useSelector((state: RootState) => state.auth);
    const [rules, setRules] = useState<string[]>(RULES_FALLBACK);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        // Формулировки правил — с сервера (единый источник); не пришли — остаётся встроенный список.
        fetch(`${API}/auth/password-policy`)
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => { if (data?.rules?.length) setRules(data.rules); })
            .catch(() => undefined);
    }, []);

    const leave = () => {
        serverLogout(token);
        dispatch(logout());
        navigate('/login', { replace: true });
    };

    const onFinish = async (values: FormValues) => {
        setLoading(true);
        setError(null);
        try {
            const response = await fetch(`${API}/auth/change-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ current_password: values.current_password, new_password: values.new_password }),
            });
            if (response.status === 401) {
                leave();
                return;
            }
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                setError(typeof data?.detail === 'string' ? data.detail : 'Не удалось сменить пароль.');
                return;
            }
            dispatch(passwordChanged({ token: data.access_token }));
            message.success('Пароль изменён. Прежние сессии на других устройствах закрыты.');
            navigate('/dashboard', { replace: true });
        } catch {
            setError('Сервер недоступен. Повторите попытку.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Layout style={{ minHeight: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center', background: PREMIUM.gradient.canvas }}>
            <Card {...premiumCard('gold', { width: 460, borderTop: `2px solid ${GOLD.base}` })}>
                <div style={{ textAlign: 'center', marginBottom: SPACE.cozy }}>
                    <Title level={3} style={{ ...TYPE.pageTitle, color: BRAND.ink, marginBottom: 0 }}>
                        Смена пароля
                    </Title>
                    <Text type="secondary" style={TYPE.caption}>АСОК ИС</Text>
                </div>

                {mustChangePassword && (
                    <Alert
                        type="info"
                        showIcon
                        style={{ marginBottom: SPACE.cozy }}
                        message="Пароль выдан администратором и действует только для первого входа"
                        description="Задайте собственный пароль, чтобы продолжить работу."
                    />
                )}

                <div style={{ marginBottom: SPACE.cozy }}>
                    <Text style={{ ...TYPE.caption, color: BRAND.inkSoft }}>Требования к паролю:</Text>
                    <ul style={{ margin: `${SPACE.tight}px 0 0`, paddingLeft: SPACE.page }}>
                        {rules.map((rule) => (
                            <li key={rule}><Text style={{ ...TYPE.caption, color: BRAND.inkSoft }}>{rule}</Text></li>
                        ))}
                    </ul>
                </div>

                {error && <Alert type="error" showIcon message={error} style={{ marginBottom: SPACE.cozy }} />}

                <Form<FormValues> name="change_password_form" layout="vertical" onFinish={onFinish} requiredMark={false}>
                    <Form.Item name="current_password" label="Текущий пароль"
                        rules={[{ required: true, message: 'Введите текущий пароль' }]}>
                        <Input.Password prefix={<LockOutlined />} autoComplete="current-password" />
                    </Form.Item>
                    <Form.Item name="new_password" label="Новый пароль" hasFeedback
                        rules={[
                            { required: true, message: 'Введите новый пароль' },
                            {
                                validator: (_, value: string) => {
                                    const issues = value ? clientPasswordIssues(value) : [];
                                    return issues.length ? Promise.reject(new Error(`Нужно: ${issues.join('; ')}`)) : Promise.resolve();
                                },
                            },
                        ]}>
                        <Input.Password prefix={<LockOutlined />} autoComplete="new-password" />
                    </Form.Item>
                    <Form.Item name="confirm" label="Повторите новый пароль" dependencies={['new_password']} hasFeedback
                        rules={[
                            { required: true, message: 'Повторите новый пароль' },
                            ({ getFieldValue }) => ({
                                validator: (_, value: string) => (!value || value === getFieldValue('new_password')
                                    ? Promise.resolve()
                                    : Promise.reject(new Error('Пароли не совпадают'))),
                            }),
                        ]}>
                        <Input.Password prefix={<LockOutlined />} autoComplete="new-password" />
                    </Form.Item>
                    <Form.Item style={{ marginBottom: 0 }}>
                        <Button type="primary" htmlType="submit" loading={loading} style={{ width: '100%' }}>
                            Сменить пароль
                        </Button>
                    </Form.Item>
                </Form>

                <div style={{ textAlign: 'center', marginTop: SPACE.cozy }}>
                    {mustChangePassword
                        ? <Button type="link" onClick={leave}>Выйти</Button>
                        : <Button type="link" onClick={() => navigate(-1)}>Отмена</Button>}
                </div>
            </Card>
        </Layout>
    );
};

export default ChangePasswordPage;
