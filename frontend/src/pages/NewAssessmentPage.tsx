import React, { useMemo, useState } from 'react';
import { Alert, Button, Card, Form, Input, InputNumber, Modal, Select, Space, Typography, message } from 'antd';
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

const OTHER_VALUE = '__other__';

const CHARACTERISTIC_OPTIONS = [
    'Функциональная пригодность',
    'Совместимость',
    'Надежность',
    'Пригодность для обслуживания',
    'Тестируемость',
    'Переносимость',
    'Эффективность. Показатели временных Характеристик',
    'ЭФФЕКТИВНОСТЬ',
    'Безопасность. Показатели аутентификации',
    'Удобство использования. Показатели полноты описания',
];

const SUBCHARACTERISTIC_OPTIONS = [
    'Функциональное покрытие',
    'Совместимость',
    'Коррекция ошибок',
    'Доступность технологических процессов',
    'Среднее время восстановления после ТС',
    'Полнота резервной копии данных',
    'Модифицируемость',
    'Разделение компонентов (для микросервисных систем)',
    'Корректность релизов',
    'Корректность плановых релизов',
    'Корректность срочных релизов',
    'Мониторинг бизнес-процессов',
    'Мониторинг серверов',
    'Автоматизация Регрессионной Модели',
    'Автономность тестирования',
    'ПОЛНОТА ВИДОВ ТЕСТИРОВАНИЯ',
    'Идентичность непродуктовых сред',
    'Состав тест и препрод окружений',
    'Время установки Релиза',
    'Средняя пропускная способность',
    'КОРРЕКТНОСТЬ ВРЕМЕНИ ОТКЛИКА',
    'Корректность механизма аутентификации',
    'Соответствие правил аутентификаци',
    'Реализация ролевой модели на ИС',
    'Полнота описания Руководства Пользователя',
];

type MetricFormValues = MetricCreateDto & {
    characteristic_other?: string;
    subcharacteristic_other?: string;
    val_a?: number;
    val_b?: number;
    extra_values?: Array<{ name?: string; value?: string }>;
};

export const NewAssessmentPage: React.FC = () => {
    const [assessmentForm] = Form.useForm();
    const [systemForm] = Form.useForm<SystemCreateDto>();
    const [metricForm] = Form.useForm<MetricFormValues>();
    const navigate = useNavigate();
    const { data: systems, isLoading, isError } = useGetSystemsQuery();
    const [createAssessment, { isLoading: isCreating }] = useCreateAssessmentPeriodMutation();
    const [createSystem, { isLoading: isCreatingSystem }] = useCreateSystemMutation();
    const [createMetric, { isLoading: isCreatingMetric }] = useCreateMetricMutation();
    const [systemModalOpen, setSystemModalOpen] = useState(false);
    const [metricModalOpen, setMetricModalOpen] = useState(false);
    const selectedCharacteristic = Form.useWatch('characteristic', metricForm);
    const selectedSubcharacteristic = Form.useWatch('subcharacteristic', metricForm);

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
            } else {
                message.error('Не удалось добавить систему');
            }
        }
    };

    const handleCreateMetric = async () => {
        try {
            const values = await metricForm.validateFields();
            const characteristic = values.characteristic === OTHER_VALUE
                ? values.characteristic_other?.trim()
                : values.characteristic;
            const subcharacteristic = values.subcharacteristic === OTHER_VALUE
                ? values.subcharacteristic_other?.trim()
                : values.subcharacteristic;

            if (!characteristic || !subcharacteristic) {
                message.error('Заполните характеристику и подхарактеристику');
                return;
            }

            const details = [
                values.description?.trim(),
                values.val_a != null ? `A: ${values.val_a}` : '',
                values.val_b != null ? `B: ${values.val_b}` : '',
                ...(values.extra_values || [])
                    .filter((item) => item?.name || item?.value)
                    .map((item) => `${item.name || 'Дополнительное значение'}: ${item.value || ''}`),
            ].filter(Boolean).join('\n');

            await createMetric({
                characteristic,
                subcharacteristic,
                formula_type: values.formula_type,
                description: details || undefined,
                data_source: values.data_source,
                is_active: true,
            }).unwrap();
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
                    <Text type="secondary">Добавьте систему, метрики и создайте оценочный период для заполнения данных.</Text>
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
                width={720}
            >
                <Form form={metricForm} layout="vertical" initialValues={{ formula_type: 'DIRECT', is_active: true }}>
                    <Form.Item name="characteristic" label="Характеристика" rules={[{ required: true, message: 'Выберите характеристику' }]}>
                        <Select
                            showSearch
                            placeholder="Выберите характеристику"
                            optionFilterProp="label"
                            options={[
                                ...CHARACTERISTIC_OPTIONS.map((item) => ({ value: item, label: item })),
                                { value: OTHER_VALUE, label: 'Другое' },
                            ]}
                        />
                    </Form.Item>
                    {selectedCharacteristic === OTHER_VALUE && (
                        <Form.Item
                            name="characteristic_other"
                            label="Новая характеристика"
                            rules={[{ required: true, message: 'Введите новую характеристику' }]}
                        >
                            <Input placeholder="Введите характеристику" />
                        </Form.Item>
                    )}

                    <Form.Item name="subcharacteristic" label="Подхарактеристика" rules={[{ required: true, message: 'Выберите подхарактеристику' }]}>
                        <Select
                            showSearch
                            placeholder="Выберите подхарактеристику"
                            optionFilterProp="label"
                            options={[
                                ...SUBCHARACTERISTIC_OPTIONS.map((item) => ({ value: item, label: item })),
                                { value: OTHER_VALUE, label: 'Другое' },
                            ]}
                        />
                    </Form.Item>
                    {selectedSubcharacteristic === OTHER_VALUE && (
                        <Form.Item
                            name="subcharacteristic_other"
                            label="Новая подхарактеристика"
                            rules={[{ required: true, message: 'Введите новую подхарактеристику' }]}
                        >
                            <Input placeholder="Введите подхарактеристику" />
                        </Form.Item>
                    )}

                    <Form.Item name="formula_type" label="Тип формулы" rules={[{ required: true }]}>
                        <Select
                            options={[
                                { value: 'DIRECT', label: 'DIRECT: X = A / B' },
                                { value: 'INVERSE', label: 'INVERSE: X = 1 - A / B' },
                            ]}
                        />
                    </Form.Item>

                    <Space size="middle" style={{ display: 'flex' }} align="start">
                        <Form.Item name="val_a" label="Значение A" style={{ flex: 1 }}>
                            <InputNumber min={0} precision={2} style={{ width: '100%' }} placeholder="A" />
                        </Form.Item>
                        <Form.Item name="val_b" label="Значение B" style={{ flex: 1 }}>
                            <InputNumber min={0} precision={2} style={{ width: '100%' }} placeholder="B" />
                        </Form.Item>
                    </Space>

                    <Form.List name="extra_values">
                        {(fields, { add, remove }) => (
                            <Space direction="vertical" style={{ width: '100%', marginBottom: 16 }}>
                                {fields.map((field) => (
                                    <Space key={field.key} align="baseline" style={{ display: 'flex' }}>
                                        <Form.Item {...field} name={[field.name, 'name']} label="Доп. параметр">
                                            <Input placeholder="Название" />
                                        </Form.Item>
                                        <Form.Item {...field} name={[field.name, 'value']} label="Значение">
                                            <Input placeholder="Значение" />
                                        </Form.Item>
                                        <Button danger onClick={() => remove(field.name)}>Удалить</Button>
                                    </Space>
                                ))}
                                <Button onClick={() => add()}>Добавить дополнительное значение</Button>
                            </Space>
                        )}
                    </Form.List>

                    <Form.Item name="description" label="Экспертное мнение">
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
