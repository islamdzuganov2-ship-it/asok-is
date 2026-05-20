import React, { useMemo, useState } from 'react';
import { Alert, Button, Card, Form, Input, Modal, Select, Space, Typography, message } from 'antd';
import { useNavigate } from 'react-router-dom';
import {
    MetricCreateDto,
    SystemCreateDto,
    useCreateAssessmentPeriodMutation,
    useCreateMetricMutation,
    useCreateSystemMutation,
    useGetSystemsQuery,
} from '../store/api/apiSlice';

const { Title, Text } = Typography;

export const NewAssessmentPage: React.FC = () => {
    const [assessmentForm] = Form.useForm();
    const [systemForm] = Form.useForm<SystemCreateDto>();
    const [metricForm] = Form.useForm<MetricCreateDto>();
    const navigate = useNavigate();
    const { data: systems, isLoading, isError } = useGetSystemsQuery();
    const [createAssessment, { isLoading: isCreating }] = useCreateAssessmentPeriodMutation();
    const [createSystem, { isLoading: isCreatingSystem }] = useCreateSystemMutation();
    const [createMetric, { isLoading: isCreatingMetric }] = useCreateMetricMutation();
    const [systemModalOpen, setSystemModalOpen] = useState(false);
    const [metricModalOpen, setMetricModalOpen] = useState(false);

    const periodOptions = useMemo(() => {
        const year = new Date().getFullYear();
        return [year, year - 1].flatMap((item) => [4, 3, 2, 1].map((quarter) => `Q${quarter}-${item}`));
    }, []);

    const handleAssessmentFinish = async (values: { system_id: string; period: string }) => {
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

    const handleCreateSystem = async () => {
        try {
            const values = await systemForm.validateFields();
            const created = await createSystem(values).unwrap();
            assessmentForm.setFieldValue('system_id', created.id);
            setSystemModalOpen(false);
            systemForm.resetFields();
            message.success('Система добавлена');
        } catch (error: any) {
            if (error?.status === 409) {
                message.error('Код системы уже существует');
            }
        }
    };

    const handleCreateMetric = async () => {
        try {
            const values = await metricForm.validateFields();
            await createMetric(values).unwrap();
            setMetricModalOpen(false);
            metricForm.resetFields();
            message.success('Метрика добавлена в каталог');
        } catch {
            message.error('Не удалось добавить метрику');
        }
    };

    return (
        <div style={{ maxWidth: 760, margin: '0 auto', paddingTop: 24 }}>
            <Space direction="vertical" size="large" style={{ display: 'flex' }}>
                <div>
                    <Title level={3} style={{ color: '#1F3864', marginBottom: 8 }}>Новая оценка ИС</Title>
                    <Text type="secondary">Сначала добавьте систему и необходимые метрики, затем создайте оценочный период.</Text>
                </div>

                {isError && <Alert type="error" showIcon message="Не удалось загрузить справочник систем" />}

                <Card>
                    <Space style={{ marginBottom: 16 }}>
                        <Button onClick={() => setSystemModalOpen(true)}>Добавить систему</Button>
                        <Button onClick={() => setMetricModalOpen(true)}>Добавить метрику</Button>
                    </Space>

                    <Form form={assessmentForm} layout="vertical" onFinish={handleAssessmentFinish} initialValues={{ period: periodOptions[0] }}>
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

            <Modal
                title="Добавить систему"
                open={systemModalOpen}
                onCancel={() => setSystemModalOpen(false)}
                onOk={handleCreateSystem}
                confirmLoading={isCreatingSystem}
                okText="Добавить"
                cancelText="Отмена"
            >
                <Form
                    form={systemForm}
                    layout="vertical"
                    initialValues={{
                        status_lc: 'ОЭ',
                        criticality_class: 'BUSINESS_OPERATIONAL',
                        is_active: true,
                    }}
                >
                    <Form.Item name="name" label="Название" rules={[{ required: true, message: 'Введите название системы' }]}>
                        <Input />
                    </Form.Item>
                    <Form.Item name="code" label="Код" rules={[{ required: true, message: 'Введите уникальный код' }]}>
                        <Input />
                    </Form.Item>
                    <Form.Item name="status_lc" label="Статус жизненного цикла">
                        <Select
                            options={[
                                { value: 'ОЭ', label: 'ОЭ' },
                                { value: 'ПЭ', label: 'ПЭ' },
                                { value: 'Создание и тестирование', label: 'Создание и тестирование' },
                            ]}
                        />
                    </Form.Item>
                    <Form.Item name="criticality_class" label="Критичность" rules={[{ required: true }]}>
                        <Select
                            options={[
                                { value: 'MISSION CRITICAL', label: 'MISSION CRITICAL' },
                                { value: 'BUSINESS CRITICAL', label: 'BUSINESS CRITICAL' },
                                { value: 'BUSINESS OPERATIONAL', label: 'BUSINESS OPERATIONAL' },
                            ]}
                        />
                    </Form.Item>
                    <Form.Item name="owner" label="Владелец">
                        <Input />
                    </Form.Item>
                </Form>
            </Modal>

            <Modal
                title="Добавить метрику"
                open={metricModalOpen}
                onCancel={() => setMetricModalOpen(false)}
                onOk={handleCreateMetric}
                confirmLoading={isCreatingMetric}
                okText="Добавить"
                cancelText="Отмена"
            >
                <Form form={metricForm} layout="vertical" initialValues={{ formula_type: 'DIRECT', is_active: true }}>
                    <Form.Item name="characteristic" label="Характеристика" rules={[{ required: true }]}>
                        <Input />
                    </Form.Item>
                    <Form.Item name="subcharacteristic" label="Метрика / подхарактеристика" rules={[{ required: true }]}>
                        <Input />
                    </Form.Item>
                    <Form.Item name="formula_type" label="Тип формулы" rules={[{ required: true }]}>
                        <Select
                            options={[
                                { value: 'DIRECT', label: 'DIRECT: X = A / B' },
                                { value: 'INVERSE', label: 'INVERSE: X = 1 - A / B' },
                            ]}
                        />
                    </Form.Item>
                    <Form.Item name="description" label="Описание">
                        <Input.TextArea rows={3} />
                    </Form.Item>
                    <Form.Item name="data_source" label="Источник данных">
                        <Input />
                    </Form.Item>
                </Form>
            </Modal>
        </div>
    );
};

export default NewAssessmentPage;
