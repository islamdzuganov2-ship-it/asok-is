import React, { useMemo, useState } from 'react';
import { Alert, Button, Card, Col, Empty, Row, Select, Space, Spin, Table, Tabs, Typography, Upload, message } from 'antd';
import { FileExcelOutlined, UploadOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { UploadProps } from 'antd';
import {
    useGetAssessmentPeriodsQuery,
    useGetExcelMatricesQuery,
    useGetSystemsQuery,
    useImportWorkbookMutation,
} from '../store/api/apiSlice';

const { Title, Text } = Typography;

const reportCardStyle: React.CSSProperties = {
    border: '1px solid #d9e2f3',
    borderRadius: 4,
};

export const ExcelReportsPage: React.FC = () => {
    const { data: systems } = useGetSystemsQuery();
    const { data: periods, isLoading: periodsLoading } = useGetAssessmentPeriodsQuery();
    const [periodId, setPeriodId] = useState<string | undefined>();
    const activePeriodId = periodId || periods?.[0]?.id;
    const { data, isFetching, isError, refetch } = useGetExcelMatricesQuery(activePeriodId || '', {
        skip: !activePeriodId,
    });
    const [importWorkbook, { isLoading: uploading }] = useImportWorkbookMutation();

    const systemById = useMemo(() => {
        const map = new Map<string, string>();
        (systems?.items || []).forEach((system) => map.set(system.id, system.name));
        return map;
    }, [systems]);

    const periodOptions = (periods || []).map((period) => ({
        value: period.id,
        label: `${period.period} — ${systemById.get(period.system_id) || period.system_id}`,
    }));

    const uploadProps: UploadProps = {
        accept: '.xlsx',
        maxCount: 1,
        showUploadList: false,
        beforeUpload: async (file) => {
            if (!activePeriodId) {
                message.warning('Сначала выберите период оценки');
                return false;
            }
            try {
                await importWorkbook({ id: activePeriodId, file }).unwrap();
                message.success('Матрицы отчета обновлены из Excel');
                refetch();
            } catch (error: any) {
                message.error(error?.data?.detail || 'Не удалось импортировать файл');
            }
            return false;
        },
    };

    const risksColumns: ColumnsType<any> = [
        { title: 'Характеристика', dataIndex: 'characteristic', width: 220 },
        { title: 'Подхарактеристика', dataIndex: 'subcharacteristic', width: 220 },
        { title: 'Описание риска', dataIndex: 'risk_description' },
        { title: 'Последствие риска', dataIndex: 'risk_consequence' },
        { title: 'Меры минимизации', dataIndex: 'mitigation_measures' },
    ];

    const defectsColumns: ColumnsType<any> = [
        { title: 'N', dataIndex: 'id', width: 70 },
        { title: 'Характеристика качества', dataIndex: 'characteristic', width: 240 },
        { title: 'Цифровой показатель', dataIndex: 'digital_metric', width: 160 },
        { title: 'Уровень качества', dataIndex: 'quality_metric_level', width: 180 },
        { title: 'Описание недостатка ИС', dataIndex: 'defect_description' },
    ];

    const planColumns: ColumnsType<any> = [
        { title: 'N', dataIndex: 'id', width: 70 },
        { title: 'Характеристика', dataIndex: 'characteristic', width: 220 },
        { title: 'Подхарактеристика', dataIndex: 'subcharacteristic', width: 220 },
        { title: 'Описание задачи', dataIndex: 'task_description' },
        { title: 'ВНД банка', dataIndex: 'internal_document', width: 160 },
        { title: 'Ответственный', dataIndex: 'assignee_fio', width: 180 },
        { title: 'Срок', dataIndex: 'deadline', width: 130 },
    ];

    const tableProps = {
        bordered: true,
        size: 'small' as const,
        pagination: { pageSize: 12, hideOnSinglePage: true },
        scroll: { x: 1100 },
        locale: { emptyText: <Empty description="Нет данных. Загрузите заполненный Excel-файл." /> },
    };

    return (
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
            <Row gutter={[16, 16]} align="middle" justify="space-between">
                <Col>
                    <Title level={3} style={{ margin: 0, color: '#1F3864' }}>Реестры и отчеты по качеству ИС</Title>
                    <Text type="secondary">Представление повторяет структуру Excel-шаблонов: риски, недостатки и план обеспечения качества.</Text>
                </Col>
                <Col>
                    <Space>
                        <Select
                            style={{ width: 360 }}
                            loading={periodsLoading}
                            placeholder="Период оценки"
                            value={activePeriodId}
                            options={periodOptions}
                            onChange={setPeriodId}
                        />
                        <Upload {...uploadProps}>
                            <Button type="primary" icon={<UploadOutlined />} loading={uploading}>
                                Импорт .xlsx
                            </Button>
                        </Upload>
                    </Space>
                </Col>
            </Row>

            {!activePeriodId && <Alert type="info" showIcon message="Создайте оценку ИС, чтобы увидеть отчетные матрицы." />}
            {isError && <Alert type="warning" showIcon message="Не удалось загрузить матрицы для выбранного периода." />}

            <Card style={reportCardStyle}>
                <Space style={{ marginBottom: 16 }}>
                    <FileExcelOutlined style={{ color: '#1F3864' }} />
                    <Text strong>Данные из БД</Text>
                    {isFetching && <Spin size="small" />}
                </Space>
                <Tabs
                    items={[
                        {
                            key: 'risks',
                            label: `Таблица возможных рисков (${data?.risks?.length || 0})`,
                            children: <Table columns={risksColumns} dataSource={data?.risks || []} rowKey={(_, index = 0) => `risk-${index}`} {...tableProps} />,
                        },
                        {
                            key: 'defects',
                            label: `Перечень недостатков ИС (${data?.defects?.length || 0})`,
                            children: <Table columns={defectsColumns} dataSource={data?.defects || []} rowKey="id" {...tableProps} />,
                        },
                        {
                            key: 'plan',
                            label: `План обеспечения качества (${data?.plan?.length || 0})`,
                            children: <Table columns={planColumns} dataSource={data?.plan || []} rowKey="id" {...tableProps} />,
                        },
                    ]}
                />
            </Card>
        </Space>
    );
};

export default ExcelReportsPage;
