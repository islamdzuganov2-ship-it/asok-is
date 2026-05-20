import React, { useMemo } from 'react';
import { Alert, Button, Card, Form, Select, Space, Typography, message } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useCreateAssessmentPeriodMutation, useGetSystemsQuery } from '../store/api/apiSlice';

const { Title, Text } = Typography;

export const NewAssessmentPage: React.FC = () => {
    const [form] = Form.useForm();
    const navigate = useNavigate();
    const { data: systems, isLoading, isError } = useGetSystemsQuery();
    const [createAssessment, { isLoading: isCreating }] = useCreateAssessmentPeriodMutation();

    const periodOptions = useMemo(() => {
        const year = new Date().getFullYear();
        return [year, year - 1].flatMap((item) => [4, 3, 2, 1].map((quarter) => `Q${quarter}-${item}`));
    }, []);

    const handleFinish = async (values: { system_id: string; period: string }) => {
        try {
            const result = await createAssessment(values).unwrap();
            message.success('Сессия оценки создана');
            navigate(`/assessments/${result.id}/input`);
        } catch (error: any) {
            if (error?.status === 409) {
                message.error('Оценка для выбранной системы и периода уже существует');
                return;
            }
            message.error('Не удалось создать сессию оценки');
        }
    };

    return (
        <div style={{ maxWidth: 640, margin: '0 auto', paddingTop: 24 }}>
            <Space direction="vertical" size="large" style={{ display: 'flex' }}>
                <div>
                    <Title level={3} style={{ color: '#1F3864', marginBottom: 8 }}>Новая оценка ИС</Title>
                    <Text type="secondary">Выберите информационную систему и отчетный период.</Text>
                </div>

                {isError && <Alert type="error" showIcon message="Не удалось загрузить справочник систем" />}

                <Card>
                    <Form form={form} layout="vertical" onFinish={handleFinish} initialValues={{ period: periodOptions[0] }}>
                        <Form.Item
                            name="system_id"
                            label="Информационная система"
                            rules={[{ required: true, message: 'Выберите систему из реестра' }]}
                        >
                            <Select
                                loading={isLoading}
                                showSearch
                                placeholder="Начните вводить название ИС"
                                optionFilterProp="label"
                                options={(systems?.items || []).map((system) => ({
                                    value: system.id,
                                    label: `${system.name}${system.code ? ` (${system.code})` : ''}`,
                                }))}
                            />
                        </Form.Item>

                        <Form.Item
                            name="period"
                            label="Отчетный период"
                            rules={[{ required: true, message: 'Укажите период оценки' }]}
                        >
                            <Select options={periodOptions.map((period) => ({ value: period, label: period }))} />
                        </Form.Item>

                        <Form.Item style={{ marginBottom: 0, textAlign: 'right' }}>
                            <Button onClick={() => navigate('/dashboard')} style={{ marginRight: 8 }}>
                                Отмена
                            </Button>
                            <Button type="primary" htmlType="submit" loading={isCreating}>
                                Инициализировать
                            </Button>
                        </Form.Item>
                    </Form>
                </Card>
            </Space>
        </div>
    );
};

export default NewAssessmentPage;
