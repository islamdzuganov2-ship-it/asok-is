import React from 'react';
import { Typography, Tabs, Table, Card, Button, Upload, message, Space, Spin, Alert } from 'antd';
import { UploadOutlined, DownloadOutlined } from '@ant-design/icons';
import type { TabsProps, UploadProps } from 'antd';
import { useGetExcelMatricesQuery } from '../store/api/apiSlice';

const { Title } = Typography;

// Безопасные маппинги колонок, поддерживающие оба формата (camelCase и snake_case)
const risksColumns = [
    { title: 'Характеристика', dataIndex: 'characteristic', key: 'characteristic' },
    { 
        title: 'Подхарактеристика', 
        dataIndex: 'subCharacteristic', 
        key: 'subCharacteristic',
        render: (text: string, record: any) => text || record.subcharacteristic || '-' 
    },
    { 
        title: 'Описание риска', 
        dataIndex: 'riskDescription', 
        key: 'riskDescription',
        render: (text: string, record: any) => text || record.risk_description || '-' 
    },
    { 
        title: 'Последствие риска', 
        dataIndex: 'riskConsequence', 
        key: 'riskConsequence',
        render: (text: string, record: any) => text || record.risk_consequence || '-' 
    },
    { 
        title: 'Меры по минимизации', 
        dataIndex: 'mitigation', 
        key: 'mitigation',
        render: (text: string, record: any) => text || record.mitigation_measures || '-' 
    },
];

const defectsColumns = [
    { title: '№', dataIndex: 'id', key: 'id', width: 60 },
    { title: 'Характеристика качества', dataIndex: 'characteristic', key: 'characteristic' },
    { 
        title: 'Показатель качества', 
        dataIndex: 'qualityMetric', 
        key: 'qualityMetric',
        render: (text: string, record: any) => text || record.quality_metric_level || '-' 
    },
    { 
        title: 'Цифровой показатель', 
        dataIndex: 'digitalMetric', 
        key: 'digitalMetric',
        render: (text: string, record: any) => text || record.digital_metric || '-' 
    },
    { 
        title: 'Описание недостатка ИС', 
        dataIndex: 'defectDescription', 
        key: 'defectDescription',
        render: (text: string, record: any) => text || record.defect_description || '-' 
    },
];

const planColumns = [
    { title: '№', dataIndex: 'id', key: 'id', width: 60 },
    { title: 'Характеристика качества', dataIndex: 'characteristic', key: 'characteristic' },
    { 
        title: 'Описание задачи', 
        dataIndex: 'taskDescription', 
        key: 'taskDescription',
        render: (text: string, record: any) => text || record.task_description || '-' 
    },
    { 
        title: 'ВНД Банка', 
        dataIndex: 'internalDocument', 
        key: 'internalDocument',
        render: (text: string, record: any) => text || record.internal_document || '-' 
    },
    { 
        title: 'Ответственный (ФИО)', 
        dataIndex: 'assignee', 
        key: 'assignee',
        render: (text: string, record: any) => text || record.assignee_fio || '-' 
    },
    { title: 'Срок выполнения', dataIndex: 'deadline', key: 'deadline' },
];

export const ExcelReportsPage: React.FC = () => {
    // Временный дефолтный UUID, чтобы не вызывать падение при отсутствии параметров в URL
    const periodId = "00000000-0000-0000-0000-000000000000"; 
    
    const { data, isLoading, isError, refetch } = useGetExcelMatricesQuery(periodId, {
        skip: !periodId
    });

    const uploadProps: UploadProps = {
        name: 'file',
        action: `/api/v1/excel_upload/import-assessment?period_id=${periodId}`,
        headers: { authorization: 'authorization-text' },
        onChange(info) {
            if (info.file.status === 'done') {
                message.success(`Файл ${info.file.name} успешно загружен.`);
                refetch();
            } else if (info.file.status === 'error') {
                message.error(`Ошибка загрузки файла ${info.file.name}.`);
            }
        },
    };

    if (isLoading) return <Spin size="large" style={{ display: 'flex', margin: '20vh auto' }} />;
    if (isError) return <Alert message="Сервер вернул 404. Ожидание деплоя бэкенд-эндпоинтов матриц." type="warning" showIcon style={{ margin: 16 }} />;

    const items: TabsProps['items'] = [
        {
            key: '1',
            label: 'Таблица возможных рисков',
            children: (
                <Table 
                    columns={risksColumns} 
                    dataSource={data?.risks || []} 
                    rowKey={(record, index) => record.id || record.characteristic || String(index)} 
                    bordered 
                    size="middle"
                />
            ),
        },
        {
            key: '2',
            label: 'Перечень недостатков ИС',
            children: (
                <Table 
                    columns={defectsColumns} 
                    dataSource={data?.defects || []} 
                    rowKey={(record, index) => record.id || String(index)} 
                    bordered 
                    size="middle"
                />
            ),
        },
        {
            key: '3',
            label: 'План обеспечения качества',
            children: (
                <Table 
                    columns={planColumns} 
                    dataSource={data?.plan || []} 
                    rowKey={(record, index) => record.id || String(index)} 
                    bordered 
                    size="middle"
                />
            ),
        },
    ];

    return (
        <div style={{ padding: '16px 0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                <Title level={2} style={{ color: '#1F3864', margin: 0 }}>
                    Реестры и Отчеты (Данные матриц)
                </Title>
                <Space>
                    <Button icon={<DownloadOutlined />}>Экспорт в Excel</Button>
                    <Upload {...uploadProps} showUploadList={false}>
                        <Button type="primary" icon={<UploadOutlined />}>Импорт данных (.xlsx)</Button>
                    </Upload>
                </Space>
            </div>
            <Card>
                <Tabs defaultActiveKey="1" items={items} />
            </Card>
        </div>
    );
};

// Экспорт по умолчанию обязателен для работы React.lazy()
export default ExcelReportsPage;