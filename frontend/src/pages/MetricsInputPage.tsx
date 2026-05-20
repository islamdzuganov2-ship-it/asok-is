import React, { useEffect, useState } from 'react';
import { Alert, Button, Input, InputNumber, Spin, Table, Typography, Upload, message } from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import {
    EditableMetric,
    useGetAssessmentMetricsQuery,
    useImportAssessmentExcelMutation,
    useSaveAssessmentMetricsMutation,
} from '../store/api/apiSlice';

const { Title } = Typography;
const { TextArea } = Input;

export const MetricsInputPage: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { data, isLoading, isError } = useGetAssessmentMetricsQuery(id!, { skip: !id });
    const [saveMetrics, { isLoading: isSaving }] = useSaveAssessmentMetricsMutation();
    const [importExcel, { isLoading: isImporting }] = useImportAssessmentExcelMutation();
    const [metrics, setMetrics] = useState<EditableMetric[]>([]);

    useEffect(() => {
        if (data) {
            setMetrics(data);
        }
    }, [data]);

    const handleFieldChange = (metricId: string, field: keyof EditableMetric, value: string | number | null) => {
        setMetrics((prev) => prev.map((metric) => (metric.id === metricId ? { ...metric, [field]: value } : metric)));
    };

    const handleSubmit = async () => {
        if (!id) return;
        for (const metric of metrics) {
            if (metric.val_b === 0 && !metric.expert_comment?.trim()) {
                message.error(`Метрика "${metric.name}": укажите причину невозможности измерения`);
                return;
            }
            if (metric.val_a === null || metric.val_b === null) {
                message.warning(`Метрика "${metric.name}": заполните A и B`);
                return;
            }
        }

        try {
            await saveMetrics({ id, metrics }).unwrap();
            message.success('Метрики сохранены и рассчитаны');
            navigate(`/assessments/${id}/review`);
        } catch {
            message.error('Ошибка при сохранении метрик');
        }
    };

    const handleImport = async (file: File) => {
        if (!id) return Upload.LIST_IGNORE;
        try {
            const result = await importExcel({ id, file }).unwrap();
            message.success(`Импортировано строк: ${result.imported}, пропущено: ${result.skipped}`);
        } catch {
            message.error('Не удалось импортировать Excel-файл');
        }
        return Upload.LIST_IGNORE;
    };

    if (isLoading) {
        return <Spin size="large" style={{ display: 'flex', margin: '20vh auto' }} />;
    }
    if (isError) {
        return <Alert type="error" showIcon message="Не удалось загрузить метрики оценки" />;
    }

    const columns = [
        {
            title: 'Характеристика / Метрика',
            dataIndex: 'name',
            width: '30%',
            render: (text: string, record: EditableMetric) => (
                <div>
                    <strong>{text}</strong>
                    <div style={{ fontSize: 12, color: 'gray' }}>{record.description}</div>
                </div>
            ),
        },
        {
            title: 'Числитель (A)',
            dataIndex: 'val_a',
            width: '15%',
            render: (_: unknown, record: EditableMetric) => (
                <InputNumber min={0} style={{ width: '100%' }} value={record.val_a} onChange={(value) => handleFieldChange(record.id, 'val_a', value)} />
            ),
        },
        {
            title: 'Знаменатель (B)',
            dataIndex: 'val_b',
            width: '15%',
            render: (_: unknown, record: EditableMetric) => (
                <InputNumber min={0} style={{ width: '100%' }} value={record.val_b} onChange={(value) => handleFieldChange(record.id, 'val_b', value)} />
            ),
        },
        {
            title: 'Обоснование при B=0',
            dataIndex: 'expert_comment',
            width: '40%',
            render: (_: unknown, record: EditableMetric) => (
                <TextArea
                    rows={2}
                    value={record.expert_comment}
                    onChange={(event) => handleFieldChange(record.id, 'expert_comment', event.target.value)}
                    status={record.val_b === 0 && !record.expert_comment ? 'error' : ''}
                />
            ),
        },
    ];

    return (
        <div>
            <Title level={3}>Ввод первичных данных</Title>
            <Alert
                message="Заполните параметры A и B вручную или импортируйте .xlsx с колонками metric_id/name, val_a, val_b. Поддерживаются многолистовые файлы."
                type="info"
                showIcon
                style={{ marginBottom: 24 }}
            />
            <Upload
                accept=".xlsx"
                maxCount={1}
                showUploadList={false}
                beforeUpload={(file) => handleImport(file)}
            >
                <Button icon={<UploadOutlined />} loading={isImporting} style={{ marginBottom: 16 }}>
                    Импортировать Excel
                </Button>
            </Upload>
            <Table dataSource={metrics} columns={columns} rowKey="id" pagination={false} bordered />
            <div style={{ marginTop: 24, textAlign: 'right' }}>
                <Button type="primary" size="large" onClick={handleSubmit} loading={isSaving}>
                    Сохранить и рассчитать
                </Button>
            </div>
        </div>
    );
};

export default MetricsInputPage;
