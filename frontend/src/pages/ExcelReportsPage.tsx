import React, { useMemo, useState } from 'react';
import { Alert, Button, Card, Col, Empty, Row, Segmented, Select, Space, Spin, Table, Tabs, Tag, Typography, Upload, message } from 'antd';
import { FileExcelOutlined, UploadOutlined, DownloadOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { UploadProps } from 'antd';
import { useDispatch, useSelector } from 'react-redux';
import {
    useGetAssessmentPeriodsQuery,
    useGetExcelMatricesQuery,
    useGetSystemsQuery,
    useImportWorkbookMutation,
} from '../store/api/apiSlice';
import { RootState } from '../store';
import {
    approveProposal, rejectProposal, selectProposals, type ProposalStatus,
} from '../store/slices/governanceSlice';

const { Title, Text } = Typography;

/** Экспорт массива объектов в CSV (UTF-8 с BOM для Excel). Без внешних зависимостей. */
function exportCsv(filename: string, columns: { title: string; dataIndex: string }[], rows: any[]) {
    if (!rows.length) { return; }
    const esc = (v: any) => {
        const s = v == null ? '' : String(v);
        return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = columns.map((c) => esc(c.title)).join(';');
    const body = rows.map((r) => columns.map((c) => esc(r[c.dataIndex])).join(';')).join('\n');
    const blob = new Blob(['﻿' + header + '\n' + body], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

const PROPOSAL_STATUS_TAG: Record<ProposalStatus, { color: string; label: string }> = {
    PENDING_APPROVAL: { color: 'gold', label: 'Ожидает одобрения' },
    APPROVED: { color: 'green', label: 'Одобрена' },
    REJECTED: { color: 'red', label: 'Отклонена' },
};

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

    const dispatch = useDispatch();
    const proposals = useSelector(selectProposals);
    const currentUser = useSelector((s: RootState) => s.auth.fullName) || 'Топ-менеджмент';
    const [activeTab, setActiveTab] = useState('risks');
    const [proposalFilter, setProposalFilter] = useState<'ALL' | ProposalStatus>('ALL');

    const filteredProposals = useMemo(
        () => proposals.filter((p) => proposalFilter === 'ALL' || p.status === proposalFilter),
        [proposals, proposalFilter],
    );

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

    const proposalsColumns: ColumnsType<any> = [
        { title: 'ИС', dataIndex: 'systemName', width: 180 },
        { title: 'Подхарактеристика', dataIndex: 'characteristic', width: 180 },
        { title: 'Метрика', dataIndex: 'metricName', width: 180 },
        { title: 'Расч. %', dataIndex: 'calculatedScore', width: 90, render: (v: number) => `${v}%` },
        { title: 'Обоснование (суждение)', dataIndex: 'rationale' },
        { title: 'Что ожидается от ЛПР', dataIndex: 'expectation' },
        { title: 'Ответственный', dataIndex: 'owner', width: 150 },
        { title: 'Срок', dataIndex: 'dueDate', width: 110 },
        {
            title: 'Статус', dataIndex: 'status', width: 160,
            render: (s: ProposalStatus) => <Tag color={PROPOSAL_STATUS_TAG[s].color}>{PROPOSAL_STATUS_TAG[s].label}</Tag>,
        },
        {
            title: 'Решение', key: 'decision', width: 170, fixed: 'right' as const,
            render: (_: unknown, rec: any) =>
                rec.status === 'PENDING_APPROVAL' ? (
                    <Space>
                        <Button size="small" type="primary"
                            onClick={() => dispatch(approveProposal({ id: rec.id, by: currentUser }))}>
                            Одобрить
                        </Button>
                        <Button size="small" danger
                            onClick={() => dispatch(rejectProposal({ id: rec.id, by: currentUser }))}>
                            Отклонить
                        </Button>
                    </Space>
                ) : (
                    <Text type="secondary" style={{ fontSize: 12 }}>{rec.decidedBy || '—'}</Text>
                ),
        },
    ];

    const tableProps = {
        bordered: true,
        size: 'small' as const,
        pagination: { pageSize: 12, hideOnSinglePage: true },
        scroll: { x: 1100 },
        locale: { emptyText: <Empty description="Нет данных. Загрузите заполненный Excel-файл." /> },
    };

    const handleExport = () => {
        const map: Record<string, { cols: ColumnsType<any>; rows: any[]; name: string }> = {
            risks: { cols: risksColumns, rows: data?.risks || [], name: 'риски' },
            defects: { cols: defectsColumns, rows: data?.defects || [], name: 'недостатки' },
            plan: { cols: planColumns, rows: data?.plan || [], name: 'план_качества' },
            measures: { cols: proposalsColumns.filter((c: any) => c.dataIndex), rows: filteredProposals, name: 'реестр_мер' },
        };
        const sel = map[activeTab];
        if (!sel || !sel.rows.length) { message.info('Нет данных для экспорта в этой вкладке'); return; }
        exportCsv(`asok_${sel.name}.csv`, sel.cols as any, sel.rows);
        message.success('CSV сформирован');
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
                        <Button icon={<DownloadOutlined />} onClick={handleExport}>
                            Экспорт CSV
                        </Button>
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
                    activeKey={activeTab}
                    onChange={setActiveTab}
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
                        {
                            key: 'measures',
                            label: `Реестр мер качества (${proposals.length})`,
                            children: (
                                <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                                    <Space style={{ justifyContent: 'space-between', width: '100%' }} wrap>
                                        <Text type="secondary">
                                            Меры и профессиональные суждения менеджера по качеству. Топ-менеджмент одобряет/отклоняет.
                                        </Text>
                                        <Segmented
                                            value={proposalFilter}
                                            onChange={(v) => setProposalFilter(v as any)}
                                            options={[
                                                { label: 'Все', value: 'ALL' },
                                                { label: 'Ожидают', value: 'PENDING_APPROVAL' },
                                                { label: 'Одобрены', value: 'APPROVED' },
                                                { label: 'Отклонены', value: 'REJECTED' },
                                            ]}
                                        />
                                    </Space>
                                    <Table
                                        columns={proposalsColumns}
                                        dataSource={filteredProposals}
                                        rowKey="id"
                                        {...tableProps}
                                        scroll={{ x: 1400 }}
                                        locale={{ emptyText: <Empty description="Меры ещё не создавались менеджером по качеству." /> }}
                                    />
                                </Space>
                            ),
                        },
                    ]}
                />
            </Card>
        </Space>
    );
};

export default ExcelReportsPage;
