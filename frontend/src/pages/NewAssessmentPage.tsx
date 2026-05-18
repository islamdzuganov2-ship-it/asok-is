/**
 * Экран инициализации новой оценки (Роли: Аналитик, Менеджер, Админ).
 * Позволяет выбрать информационную систему из справочника и запустить процесс сбора метрик.
 */
import React, { useState } from 'react';
import { Card, Form, Select, Input, Button, Typography, message, Space } from 'antd';
import { useNavigate } from 'react-router-dom';
// В реальном проекте раскомментировать хуки:
// import { useGetSystemsQuery, useCreateAssessmentMutation } from '../store/api/apiSlice';

const { Title, Text } = Typography;
const { Option } = Select;

export const NewAssessmentPage: React.FC = () => {
    const [form] = Form.useForm();
    const navigate = useNavigate();
    const [loading, setLoading] = useState(false);

    // Mock-данные систем (должны приходить из useGetSystemsQuery)
    const mockSystems = [
        { id: 'sys-1', name: 'CRM ОПК', code: 'CRM_OPK' },
        { id: 'sys-2', name: 'АБС Core', code: 'ABS_CORE' },
        { id: 'sys-3', name: 'Портал HR', code: 'HR_PORTAL' },
    ];

    /**
     * Обработчик создания новой сессии оценки.
     */
    const handleFinish = async (values: { systemId: string; period: string; comments?: string }) => {
        setLoading(true);
        try {
            // Имитация задержки сети. Заменить на: await createAssessment(values).unwrap();
            await new Promise(resolve => setTimeout(resolve, 800));
            
            message.success('Сессия оценки успешно инициализирована');
            // Перенаправляем аналитика сразу на экран ввода метрик (Mock ID = 123)
            navigate('/assessments/123/input'); 
        } catch (error) {
            message.error('Не удалось создать сессию оценки. Проверьте соединение с сервером.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{ maxWidth: 600, margin: '0 auto', paddingTop: 24 }}>
            <Space direction="vertical" size="large" style={{ display: 'flex' }}>
                <div>
                    <Title level={3} style={{ color: '#1F3864', marginBottom: 8 }}>Новая оценка ИС</Title>
                    <Text type="secondary">Выберите информационную систему и отчетный период для инициализации расчета метрик качества (ISO 25010).</Text>
                </div>

                <Card>
                    <Form 
                        form={form} 
                        layout="vertical" 
                        onFinish={handleFinish}
                        initialValues={{ period: 'Q2 2026' }}
                    >
                        <Form.Item 
                            name="systemId" 
                            label="Информационная система" 
                            rules={[{ required: true, message: 'Выберите систему из реестра' }]}
                        >
                            <Select
                                showSearch
                                placeholder="Начните вводить название ИС"
                                filterOption={(input, option) =>
                                    (option?.children as unknown as string).toLowerCase().includes(input.toLowerCase())
                                }
                            >
                                {mockSystems.map(sys => (
                                    <Option key={sys.id} value={sys.id}>{sys.name} ({sys.code})</Option>
                                ))}
                            </Select>
                        </Form.Item>

                        <Form.Item 
                            name="period" 
                            label="Отчетный период" 
                            rules={[{ required: true, message: 'Укажите период оценки' }]}
                        >
                            <Input placeholder="Например: Q3 2026 или 2026-08" />
                        </Form.Item>

                        <Form.Item 
                            name="comments" 
                            label="Комментарий к сессии (опционально)"
                        >
                            <Input.TextArea rows={3} placeholder="Дополнительная информация для менеджера по качеству..." />
                        </Form.Item>

                        <Form.Item style={{ marginBottom: 0, textAlign: 'right' }}>
                            <Button onClick={() => navigate('/dashboard')} style={{ marginRight: 8 }}>
                                Отмена
                            </Button>
                            <Button type="primary" htmlType="submit" loading={loading}>
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