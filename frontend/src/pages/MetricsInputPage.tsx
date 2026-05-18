/**
 * Экран ввода метрик (Роль: Тест-Аналитик).
 * Реализует табличный ввод данных (val_a, val_b) с жесткой локальной валидацией,
 * как указано в ТЗ п.3.1 (Блокировка отправки, если B==0 без комментария).
 */
import React, { useState } from 'react';
import { Table, InputNumber, Input, Button, Typography, Alert, message, Form } from 'antd';
import { useParams } from 'react-router-dom';
// import { useGetAssessmentMetricsQuery, useSaveMetricsMutation } from '../store/api/apiSlice';

const { Title } = Typography;
const { TextArea } = Input;

// DTO для локального стейта редактирования метрики
interface EditableMetric {
    id: string;
    name: string;
    description: string;
    val_a: number | null;
    val_b: number | null;
    expert_comment: string;
}

export const MetricsInputPage: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const [form] = Form.useForm();
    
    // В реальном проекте берем из RTK Query
    // const { data, isLoading } = useGetAssessmentMetricsQuery(id!);
    // const [saveMetrics, { isLoading: isSaving }] = useSaveMetricsMutation();

    // Mock-данные для демонстрации
    const [metrics, setMetrics] = useState<EditableMetric[]>([
        { id: '1', name: 'Плотность дефектов', description: 'Отношение дефектов к KLOC', val_a: null, val_b: null, expert_comment: '' },
        { id: '2', name: 'Доля автоматизации', description: 'Отношение автотестов ко всем тестам', val_a: null, val_b: null, expert_comment: '' },
    ]);

    /**
     * Обновление конкретного поля в локальном стейте метрики.
     */
    const handleFieldChange = (metricId: string, field: keyof EditableMetric, value: any) => {
        setMetrics(prev => prev.map(m => m.id === metricId ? { ...m, [field]: value } : m));
    };

    /**
     * Валидация и отправка данных.
     * Реализует требование ТЗ 3.1: "Блокировка отправки формы, если B==0".
     */
    const handleSubmit = async () => {
        for (const metric of metrics) {
            // Проверка бизнес-логики: если B = 0, обязательно нужен комментарий
            if (metric.val_b === 0 && (!metric.expert_comment || metric.expert_comment.trim() === '')) {
                message.error(`Метрика "${metric.name}": Укажите причину невозможности измерения (т.к. знаменатель B = 0)`);
                return;
            }
            if (metric.val_a === null || metric.val_b === null) {
                message.warning(`Метрика "${metric.name}": Заполните числитель (A) и знаменатель (B)`);
                return;
            }
        }

        try {
            // await saveMetrics({ periodId: id, metrics }).unwrap();
            console.log('Данные к отправке:', metrics);
            message.success('Метрики успешно сохранены и отправлены на расчет');
        } catch (error) {
            message.error('Ошибка при сохранении метрик на сервере');
        }
    };

    const columns = [
        { 
            title: 'Характеристика / Метрика', 
            dataIndex: 'name', 
            width: '25%',
            render: (text: string, record: EditableMetric) => (
                <div>
                    <strong>{text}</strong>
                    <div style={{ fontSize: '12px', color: 'gray' }}>{record.description}</div>
                </div>
            )
        },
        {
            title: 'Числитель (A)',
            dataIndex: 'val_a',
            width: '15%',
            render: (_: any, record: EditableMetric) => (
                <InputNumber 
                    style={{ width: '100%' }}
                    value={record.val_a} 
                    onChange={(val) => handleFieldChange(record.id, 'val_a', val)} 
                    placeholder="Например, 15"
                />
            )
        },
        {
            title: 'Знаменатель (B)',
            dataIndex: 'val_b',
            width: '15%',
            render: (_: any, record: EditableMetric) => (
                <InputNumber 
                    style={{ width: '100%' }}
                    value={record.val_b} 
                    onChange={(val) => handleFieldChange(record.id, 'val_b', val)} 
                    placeholder="Например, 100"
                />
            )
        },
        {
            title: 'Обоснование при B=0',
            dataIndex: 'expert_comment',
            width: '35%',
            render: (_: any, record: EditableMetric) => (
                <TextArea 
                    rows={2}
                    value={record.expert_comment}
                    onChange={(e) => handleFieldChange(record.id, 'expert_comment', e.target.value)}
                    placeholder="Заполните, если метрику невозможно измерить"
                    status={record.val_b === 0 && !record.expert_comment ? 'error' : ''}
                />
            )
        }
    ];

    return (
        <div>
            <Title level={3}>Ввод первичных данных (Аттестационный лист)</Title>
            <Alert 
                message="Инструкция для Тест-Аналитика" 
                description="Заполните расчетные параметры A и B для каждой метрики. Если значение B равно нулю (невозможно измерить), система заблокирует сохранение до тех пор, пока вы не укажете обоснование в текстовом поле." 
                type="info" 
                showIcon 
                style={{ marginBottom: 24 }}
            />
            
            <Table 
                dataSource={metrics} 
                columns={columns} 
                rowKey="id" 
                pagination={false}
                bordered
            />

            <div style={{ marginTop: 24, textAlign: 'right' }}>
                <Button type="primary" size="large" onClick={handleSubmit}>
                    Сохранить и рассчитать
                </Button>
            </div>
        </div>
    );
};

export default MetricsInputPage;