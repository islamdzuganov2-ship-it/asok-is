import React from 'react';
import { Card, Table, Tabs, Empty, Spin } from 'antd';
import { AllTemplates } from '../store/api/apiSlice';

interface TemplatesDisplayProps {
    templates: AllTemplates | undefined;
    isLoading: boolean;
}

export const TemplatesDisplay: React.FC<TemplatesDisplayProps> = ({ templates, isLoading }) => {
    if (isLoading) {
        return <Spin size="large" style={{ display: 'flex', justifyContent: 'center', margin: '40px 0' }} />;
    }

    if (!templates) {
        return <Empty description="Нет доступных шаблонов" />;
    }

    // Helper to convert array of objects to table columns
    const getTableColumns = (data: Record<string, any>[]) => {
        if (!data || data.length === 0) return [];
        const keys = Object.keys(data[0]);
        return keys.map(key => ({
            title: key,
            dataIndex: key,
            key: key,
            width: Math.max(100, Math.floor(1200 / keys.length)),
            ellipsis: true,
            render: (text: any) => {
                if (text === null || text === undefined) return '';
                if (typeof text === 'object') return JSON.stringify(text);
                return String(text);
            },
        }));
    };

    const getRowKey = (record: any, index: number) => `${index}-${JSON.stringify(record).substring(0, 20)}`;

    const tabItems = [
        {
            key: 'metrics',
            label: 'Шаблон Метрик',
            children: (
                <Card>
                    {templates.metrics && templates.metrics.length > 0 ? (
                        <Table
                            columns={getTableColumns(templates.metrics)}
                            dataSource={templates.metrics}
                            rowKey={getRowKey}
                            pagination={{ pageSize: 10, position: ['bottomCenter'] }}
                            scroll={{ x: 1200 }}
                            size="small"
                        />
                    ) : (
                        <Empty description="Нет данных в шаблоне метрик" />
                    )}
                </Card>
            ),
        },
        {
            key: 'risks',
            label: 'Матрица Рисков',
            children: (
                <Card>
                    {templates.risks && templates.risks.length > 0 ? (
                        <Table
                            columns={getTableColumns(templates.risks)}
                            dataSource={templates.risks}
                            rowKey={getRowKey}
                            pagination={{ pageSize: 10, position: ['bottomCenter'] }}
                            scroll={{ x: 1200 }}
                            size="small"
                        />
                    ) : (
                        <Empty description="Нет данных в матрице рисков" />
                    )}
                </Card>
            ),
        },
        {
            key: 'qualityReport',
            label: 'Детальный Отчет по Метрикам',
            children: (
                <Card>
                    {templates.qualityReport && templates.qualityReport.length > 0 ? (
                        <Table
                            columns={getTableColumns(templates.qualityReport)}
                            dataSource={templates.qualityReport}
                            rowKey={getRowKey}
                            pagination={{ pageSize: 10, position: ['bottomCenter'] }}
                            scroll={{ x: 1200 }}
                            size="small"
                        />
                    ) : (
                        <Empty description="Нет данных в детальном отчете" />
                    )}
                </Card>
            ),
        },
        {
            key: 'systemQuality',
            label: 'Качество Системы по Времени',
            children: (
                <Card>
                    {templates.systemQuality && templates.systemQuality.length > 0 ? (
                        <Table
                            columns={getTableColumns(templates.systemQuality)}
                            dataSource={templates.systemQuality}
                            rowKey={getRowKey}
                            pagination={{ pageSize: 10, position: ['bottomCenter'] }}
                            scroll={{ x: 1200 }}
                            size="small"
                        />
                    ) : (
                        <Empty description="Нет данных о качестве системы" />
                    )}
                </Card>
            ),
        },
    ];

    return (
        <Card
            title="Загруженные Шаблоны и Данные"
            style={{ marginTop: 24, marginBottom: 24 }}
        >
            <Tabs items={tabItems} />
        </Card>
    );
};

export default TemplatesDisplay;
