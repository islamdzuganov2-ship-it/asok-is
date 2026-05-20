/**
 * ТЗ: Отображение трех Excel-файлов (Риски, Недостатки, План качества) в виде вкладок.
 * Реализация включает базовые таблицы (Ant Design) с колонками, спроектированными 
 * под структуру предоставленных CSV/Excel шаблонов.
 */
import React from 'react';
import { Typography, Tabs, Table, Card, Button, Upload, message, Space, Spin, Alert } from 'antd';
import type { TabsProps } from 'antd';
import React, { useState } from 'react';
import { Typography, Tabs, Table, Card, Button, Upload, message, Space } from 'antd';
import { UploadOutlined, DownloadOutlined } from '@ant-design/icons';
import type { TabsProps, UploadProps } from 'antd';
import { useParams } from 'react-router-dom';
import { useGetExcelMatricesQuery } from '../store/api/apiSlice';
const { Title } = Typography;

// --- КОЛОНКИ ДЛЯ ТАБЛИЦ (На основе заголовков из Excel) ---

const risksColumns = [
    { title: 'Характеристика', dataIndex: 'characteristic', key: 'characteristic' },
    { title: 'Подхарактеристика', dataIndex: 'subCharacteristic', key: 'subCharacteristic' },
    { title: 'Описание риска', dataIndex: 'riskDescription', key: 'riskDescription' },
    { title: 'Последствие риска', dataIndex: 'riskConsequence', key: 'riskConsequence' },
    { title: 'Меры по минимизации', dataIndex: 'mitigation', key: 'mitigation' },
];

const defectsColumns = [
    { title: '№', dataIndex: 'id', key: 'id', width: 60 },
    { title: 'Характеристика качества', dataIndex: 'characteristic', key: 'characteristic' },
    { title: 'Показатель качества', dataIndex: 'qualityMetric', key: 'qualityMetric' },
    { title: 'Цифровой показатель', dataIndex: 'digitalMetric', key: 'digitalMetric' },
    { title: 'Описание недостатка ИС', dataIndex: 'defectDescription', key: 'defectDescription' },
];

const planColumns = [
    { title: '№', dataIndex: 'id', key: 'id', width: 60 },
    { title: 'Характеристика качества', dataIndex: 'characteristic', key: 'characteristic' },
    { title: 'Описание задачи', dataIndex: 'taskDescription', key: 'taskDescription' },
    { title: 'ВНД Банка', dataIndex: 'internalDocument', key: 'internalDocument' },
    { title: 'Ответственный (ФИО)', dataIndex: 'assignee', key: 'assignee' },
    { title: 'Срок выполнения', dataIndex: 'deadline', key: 'deadline' },
];

// --- КОМПОНЕНТ ---

export const ExcelReportsPage: React.FC = () => {
    // TODO: Интеграция с RTK Query для получения реальных данных, 
    // парсинг CSV/XLSX через бэкенд или локально (papaparse/xlsx).
    const dataSourceRisks: any[] = []; 
    const dataSourceDefects: any[] = [];
    const dataSourcePlan: any[] = [];
    // В реальном сценарии periodId берется из контекста или URL. 
    // Здесь используем хардкод для демонстрации или useParams(), если маршрут /reports/:periodId
     const periodId = "00000000-0000-0000-0000-000000000000"; // TODO: заменить на динамический ID
    
     const { data, isLoading, isError, refetch } = useGetExcelMatricesQuery(periodId);

    // Настройки компонента Upload для импорта Excel файлов
    const uploadProps: UploadProps = {
        name: 'file',
        action: `/api/v1/excel_upload/import-assessment?period_id=${periodId}`,
        headers: { authorization: 'authorization-text' },
        onChange(info) {
            if (info.file.status === 'done') {
                message.success(`Файл ${info.file.name} успешно загружен и обработан.`);
                // В реальной системе здесь будет триггер RTK Query на refetch()
                refetch();
            } else if (info.file.status === 'error') {
                message.error(`Ошибка загрузки файла ${info.file.name}.`);
            }
        },
    };

     if (isLoading) return <Spin size="large" style={{ display: 'flex', margin: '20vh auto' }} />;
     if (isError) return <Alert message="Ошибка загрузки данных реестров" type="error" />;

    const items: TabsProps['items'] = [
        {
            key: '1',
            label: 'Таблица возможных рисков',
            children: (
                <Table 
                    columns={risksColumns} 
                    dataSource={data?.risks || []}
                    rowKey="id" 
                    bordered 
                    size="middle"
                    locale={{ emptyText: 'Данные из Excel не загружены' }}
                />
            ),
        },
        {
            key: '2',
            label: 'Перечень недостатков ИС',
            children: (
                <Table 
                    columns={defectsColumns} 
                    dataSource={dataSourceDefects} 
                    rowKey="id" 
                    bordered 
                    size="middle"
                    locale={{ emptyText: 'Данные из Excel не загружены' }}
                />
            ),
        },
        {
            key: '3',
            label: 'План обеспечения качества',
            children: (
                <Table 
                    columns={planColumns} 
                    dataSource={dataSourcePlan} 
                    rowKey="id" 
                    bordered 
                    size="middle"
                    locale={{ emptyText: 'Данные из Excel не загружены' }}
                />
            ),
        },
    ];

    return (
        <div style={{ padding: '16px 0' }}>
            <Title level={2} style={{ color: '#1F3864', marginBottom: 24 }}>
                Реестры и Отчеты (Данные матриц)
            </Title>
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

export default ExcelReportsPage;