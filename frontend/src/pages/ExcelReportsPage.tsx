import React, { useMemo, useState } from 'react';
import { Alert, Button, Card, Col, Empty, Input, Row, Segmented, Select, Space, Spin, Table, Tabs, Tag, Typography, Upload, message } from 'antd';
import { FileExcelOutlined, UploadOutlined, DownloadOutlined, SearchOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { UploadProps } from 'antd';
import { shallowEqual, useSelector } from 'react-redux';
import { useAppDispatch } from '../store/hooks';
import {
    EditableMetric,
    useGetAssessmentMetricsQuery,
    useGetAssessmentPeriodsQuery,
    useGetExcelMatricesQuery,
    useGetSystemsQuery,
    useGetSystemDynamicsQuery,
    useImportWorkbookMutation,
    useSaveAssessmentMetricsMutation,
} from '../store/api/apiSlice';
import { RootState } from '../store';
import {
    approveProposal, rejectProposal, selectVisibleProposals, type ProposalStatus,
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

/** Цвета уровней качества — ключи совпадают с выводом backend map_to_level. */
const LEVEL_COLOR: Record<string, string> = {
    'Высокий уровень': 'green',
    'Выше среднего': 'cyan',
    'Средний уровень': 'gold',
    'Ниже среднего': 'orange',
    'Низкий уровень': 'red',
    'Невозможно измерить': 'default',
};

const reportCardStyle: React.CSSProperties = {
    border: '1px solid #d9e2f3',
    borderRadius: 4,
};

/** Ячейка с редактируемым комментарием — сохраняет через PUT /assessments/{id}/metrics. */
const CommentCell: React.FC<{ row: EditableMetric; periodId: string }> = ({ row, periodId }) => {
    const [value, setValue] = useState(row.expert_comment || '');
    const [save, { isLoading }] = useSaveAssessmentMetricsMutation();
    const dirty = (value || '') !== (row.expert_comment || '');
    const handleSave = async () => {
        try {
            await save({ id: periodId, metrics: [{ ...row, expert_comment: value }] }).unwrap();
            message.success('Комментарий сохранён');
        } catch {
            message.error('Не удалось сохранить комментарий');
        }
    };
    return (
        <Space.Compact style={{ width: '100%' }}>
            <Input
                size="small"
                value={value}
                placeholder="Комментарий / корректировка"
                onChange={(e) => setValue(e.target.value)}
                onPressEnter={handleSave}
            />
            <Button size="small" type="primary" loading={isLoading} disabled={!dirty} onClick={handleSave}>
                OK
            </Button>
        </Space.Compact>
    );
};

export const ExcelReportsPage: React.FC = () => {
    const { data: systems } = useGetSystemsQuery();
    const [systemId, setSystemId] = useState<string | undefined>();
    const [periodId, setPeriodId] = useState<string | undefined>();

    const { data: periods, isFetching: periodsLoading } = useGetAssessmentPeriodsQuery(
        systemId ? { system_id: systemId } : undefined,
        { skip: !systemId },
    );
    const activePeriodId = periodId;

    const { data, isFetching, isError, refetch } = useGetExcelMatricesQuery(activePeriodId || '', {
        skip: !activePeriodId,
    });
    const { data: qualityMetrics, isFetching: qualityLoading } = useGetAssessmentMetricsQuery(activePeriodId || '', {
        skip: !activePeriodId,
    });
    const [importWorkbook, { isLoading: uploading }] = useImportWorkbookMutation();
    // T-12: кросс-период — динамика характеристик ИС по всем периодам (backend /reports/system-dynamics).
    const { data: dynamics, isFetching: dynLoading } = useGetSystemDynamicsQuery(systemId ?? '', { skip: !systemId });
    const dynamicsView = useMemo(() => {
        const points = dynamics?.points ?? [];
        if (!points.length) return { columns: [] as ColumnsType<any>, rows: [] as any[] };
        const chars: string[] = [];
        points.forEach((p) => Object.keys(p.characteristics).forEach((c) => { if (!chars.includes(c)) chars.push(c); }));
        const mkRow = (label: string, get: (p: (typeof points)[number]) => number | undefined) => {
            const row: any = { key: label, characteristic: label };
            points.forEach((p) => { row[p.period] = get(p); });
            return row;
        };
        const rows = [
            mkRow('Интегральный показатель', (p) => p.integral),
            ...chars.map((c) => mkRow(c, (p) => p.characteristics[c])),
        ];
        const columns: ColumnsType<any> = [
            {
                title: 'Характеристика', dataIndex: 'characteristic', width: 220, fixed: 'left' as const,
                render: (v: string) => (v === 'Интегральный показатель' ? <Text strong>{v}</Text> : v),
            },
            ...points.map((p) => ({
                title: p.period, dataIndex: p.period, width: 100,
                render: (v: number | undefined) => (v == null ? '—' : `${v}%`),
            })),
            {
                title: 'Тренд (перв.→посл.)', key: 'trend', width: 140, fixed: 'right' as const,
                render: (_: unknown, row: any) => {
                    const first = row[points[0].period];
                    const last = row[points[points.length - 1].period];
                    if (first == null || last == null) return <Text type="secondary">—</Text>;
                    const d = Math.round((last - first) * 10) / 10;
                    const color = d > 1 ? '#6F9F86' : d < -1 ? '#C06B5A' : '#8a94a6';
                    const arrow = d > 1 ? '↑' : d < -1 ? '↓' : '→';
                    return <Text strong style={{ color }}>{arrow} {d > 0 ? '+' : ''}{d} п.п.</Text>;
                },
            },
        ];
        return { columns, rows };
    }, [dynamics]);

    const dispatch = useAppDispatch();
    // Реестр мер: в Демо — все, в LLM — только реальные (демо-меры скрыты).
    const proposals = useSelector(selectVisibleProposals, shallowEqual);
    const currentUser = useSelector((s: RootState) => s.auth.fullName) || 'Топ-менеджмент';
    const role = useSelector((s: RootState) => s.auth.role) || '';
    // Согласование работ по мере (одобрить/отклонить) — только топ-менеджмент (ADMIN-уровень), SoD ТЗ v12.
    const canDecide = ['ADMIN', 'CTO', 'CEO', 'CIO', 'EXECUTIVE'].includes(role);
    const [activeTab, setActiveTab] = useState('quality');
    const [proposalFilter, setProposalFilter] = useState<'ALL' | ProposalStatus>('ALL');
    const [measureSystemFilter, setMeasureSystemFilter] = useState<string>('ALL');

    const filteredProposals = useMemo(
        () => proposals.filter((p) =>
            (proposalFilter === 'ALL' || p.status === proposalFilter)
            && (measureSystemFilter === 'ALL' || p.systemName === measureSystemFilter)),
        [proposals, proposalFilter, measureSystemFilter],
    );
    // Уникальные ИС в реестре мер — для фильтра по системе (T-13).
    const measureSystems = useMemo(
        () => [...new Set(proposals.map((p) => p.systemName))].sort(),
        [proposals],
    );
    // Статус меры по характеристике для выбранной ИС (T-13: колонка «Статус меры» в плане качества).
    const normChar = (s: string) => (s || '').toLowerCase().replace(/ё/g, 'е').trim();
    const selectedSystemName = (systems?.items || []).find((s) => s.id === systemId)?.name;
    const measureStatusByChar = useMemo(() => {
        const map = new Map<string, ProposalStatus>();
        if (selectedSystemName) {
            proposals
                .filter((p) => p.systemName === selectedSystemName)
                .forEach((p) => map.set(normChar(p.characteristic), p.status));
        }
        return map;
    }, [proposals, selectedSystemName]);

    // T-11: поиск по тексту + фильтр по характеристике для отчётных таблиц (качество/риски/недостатки/план).
    const [searchText, setSearchText] = useState('');
    const [charFilter, setCharFilter] = useState<string | undefined>();
    const applyReportFilters = <T extends Record<string, any>>(rows: T[]): T[] => {
        const q = searchText.trim().toLowerCase();
        return rows.filter((r) =>
            (!charFilter || normChar(r.characteristic || '') === normChar(charFilter))
            && (!q || Object.values(r).some((v) => v != null && String(v).toLowerCase().includes(q))));
    };
    const reportCharacteristics = useMemo(() => {
        const set = new Set<string>();
        (qualityMetrics || []).forEach((m: any) => m.characteristic && set.add(m.characteristic));
        (data?.risks || []).forEach((r: any) => r.characteristic && set.add(r.characteristic));
        (data?.defects || []).forEach((r: any) => r.characteristic && set.add(r.characteristic));
        (data?.plan || []).forEach((r: any) => r.characteristic && set.add(r.characteristic));
        return [...set].sort();
    }, [qualityMetrics, data]);

    const systemOptions = (systems?.items || []).map((system) => ({
        value: system.id,
        label: `${system.name}${system.code ? ` (${system.code})` : ''}`,
    }));

    const periodOptions = (periods || []).map((period) => ({
        value: period.id,
        label: period.period,
    }));

    const uploadProps: UploadProps = {
        accept: '.xlsx',
        maxCount: 1,
        showUploadList: false,
        beforeUpload: async (file) => {
            if (!activePeriodId) {
                message.warning('Сначала выберите систему и период');
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

    const qualityColumns: ColumnsType<EditableMetric> = [
        { title: 'Характеристика', dataIndex: 'characteristic', width: 220 },
        { title: 'Подхарактеристика', dataIndex: 'subcharacteristic', width: 230 },
        { title: 'A', dataIndex: 'val_a', width: 70, render: (v: number | null) => (v ?? '—') },
        { title: 'B', dataIndex: 'val_b', width: 70, render: (v: number | null) => (v ?? '—') },
        {
            title: 'X', dataIndex: 'calculatedX', width: 80,
            render: (x: number | null | undefined) =>
                (x != null ? <Text strong>{x.toFixed(2)}</Text> : <Text type="secondary">—</Text>),
        },
        {
            title: 'Уровень', dataIndex: 'qualityLevel', width: 170,
            render: (level: string | null | undefined) =>
                (level ? <Tag color={LEVEL_COLOR[level] ?? 'default'}>{level}</Tag> : <Text type="secondary">—</Text>),
        },
        {
            title: 'Комментарий', dataIndex: 'expert_comment', width: 280,
            render: (_: unknown, row) => (activePeriodId ? <CommentCell row={row} periodId={activePeriodId} /> : null),
        },
    ];

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
        {
            title: 'Статус меры', key: 'measureStatus', width: 150,
            render: (_: unknown, row: any) => {
                const st = measureStatusByChar.get(normChar(row.characteristic || ''));
                return st
                    ? <Tag color={PROPOSAL_STATUS_TAG[st].color}>{PROPOSAL_STATUS_TAG[st].label}</Tag>
                    : <Text type="secondary" style={{ fontSize: 12 }}>нет меры</Text>;
            },
        },
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
                    canDecide ? (
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
                        <Text type="secondary" style={{ fontSize: 12 }}>Ожидает решения топ-менеджмента</Text>
                    )
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
        const qualityExportCols = [
            { title: 'Характеристика', dataIndex: 'characteristic' },
            { title: 'Подхарактеристика', dataIndex: 'subcharacteristic' },
            { title: 'A', dataIndex: 'val_a' },
            { title: 'B', dataIndex: 'val_b' },
            { title: 'X', dataIndex: 'calculatedX' },
            { title: 'Уровень', dataIndex: 'qualityLevel' },
            { title: 'Комментарий', dataIndex: 'expert_comment' },
        ];
        const map: Record<string, { cols: { title: string; dataIndex: string }[]; rows: any[]; name: string }> = {
            quality: { cols: qualityExportCols, rows: qualityMetrics || [], name: 'характеристики_качества' },
            risks: { cols: risksColumns as any, rows: data?.risks || [], name: 'риски' },
            defects: { cols: defectsColumns as any, rows: data?.defects || [], name: 'недостатки' },
            plan: { cols: planColumns as any, rows: data?.plan || [], name: 'план_качества' },
            measures: { cols: proposalsColumns.filter((c: any) => c.dataIndex) as any, rows: filteredProposals, name: 'реестр_мер' },
        };
        const sel = map[activeTab];
        if (!sel || !sel.rows.length) { message.info('Нет данных для экспорта в этой вкладке'); return; }
        exportCsv(`asok_${sel.name}.csv`, sel.cols, sel.rows);
        message.success('CSV сформирован');
    };

    return (
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
            <Row gutter={[16, 16]} align="middle" justify="space-between">
                <Col>
                    <Title level={3} style={{ margin: 0, color: '#1F3864' }}>Реестры и отчеты по качеству ИС</Title>
                    <Text type="secondary">Результаты оценки (характеристики качества ИС), риски, недостатки и план обеспечения качества.</Text>
                </Col>
                <Col>
                    <Space wrap>
                        <Select
                            style={{ width: 280 }}
                            showSearch
                            optionFilterProp="label"
                            placeholder="Система"
                            value={systemId}
                            options={systemOptions}
                            onChange={(v) => { setSystemId(v); setPeriodId(undefined); }}
                        />
                        <Select
                            style={{ width: 180 }}
                            loading={periodsLoading}
                            placeholder="Период"
                            value={periodId}
                            options={periodOptions}
                            disabled={!systemId}
                            onChange={setPeriodId}
                        />
                        <Input
                            allowClear
                            placeholder="Поиск по тексту"
                            prefix={<SearchOutlined />}
                            style={{ width: 200 }}
                            value={searchText}
                            onChange={(e) => setSearchText(e.target.value)}
                        />
                        <Select
                            allowClear
                            placeholder="Характеристика"
                            style={{ width: 200 }}
                            value={charFilter}
                            onChange={setCharFilter}
                            options={reportCharacteristics.map((c) => ({ value: c, label: c }))}
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

            {!systemId && <Alert type="info" showIcon message="Выберите систему и период, чтобы увидеть результаты оценки и отчётные матрицы." />}
            {systemId && !periodId && <Alert type="info" showIcon message="Выберите период оценки для выбранной системы." />}
            {isError && <Alert type="warning" showIcon message="Не удалось загрузить матрицы для выбранного периода." />}

            <Card style={reportCardStyle}>
                <Space style={{ marginBottom: 16 }}>
                    <FileExcelOutlined style={{ color: '#1F3864' }} />
                    <Text strong>Данные из БД</Text>
                    {(isFetching || qualityLoading) && <Spin size="small" />}
                </Space>
                <Tabs
                    activeKey={activeTab}
                    onChange={setActiveTab}
                    items={[
                        {
                            key: 'quality',
                            label: `Характеристики качества ИС (${qualityMetrics?.length || 0})`,
                            children: (
                                <Table<EditableMetric>
                                    columns={qualityColumns}
                                    dataSource={applyReportFilters(qualityMetrics || [])}
                                    rowKey="id"
                                    {...tableProps}
                                    scroll={{ x: 1200 }}
                                    locale={{ emptyText: <Empty description="Нет результатов оценки за период. Заполните оценку во вкладке «Новая оценка»." /> }}
                                />
                            ),
                        },
                        {
                            key: 'risks',
                            label: `Таблица возможных рисков (${data?.risks?.length || 0})`,
                            children: <Table columns={risksColumns} dataSource={applyReportFilters(data?.risks || [])} rowKey={(_, index = 0) => `risk-${index}`} {...tableProps} />,
                        },
                        {
                            key: 'defects',
                            label: `Перечень недостатков ИС (${data?.defects?.length || 0})`,
                            children: <Table columns={defectsColumns} dataSource={applyReportFilters(data?.defects || [])} rowKey="id" {...tableProps} />,
                        },
                        {
                            key: 'plan',
                            label: `План обеспечения качества (${data?.plan?.length || 0})`,
                            children: <Table columns={planColumns} dataSource={applyReportFilters(data?.plan || [])} rowKey="id" {...tableProps} />,
                        },
                        {
                            key: 'dynamics',
                            label: 'Динамика по периодам',
                            children: !systemId
                                ? <Alert type="info" showIcon message="Выберите систему — покажем динамику характеристик по всем её периодам оценки (кросс-период, тренд улучшение/ухудшение)." />
                                : dynLoading
                                    ? <div style={{ textAlign: 'center', padding: 24 }}><Spin /></div>
                                    : (
                                        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                                            <Table
                                                columns={dynamicsView.columns}
                                                dataSource={dynamicsView.rows}
                                                rowKey="key"
                                                bordered
                                                size="small"
                                                pagination={false}
                                                scroll={{ x: 900 }}
                                                locale={{ emptyText: <Empty description="Нет данных динамики за периоды этой ИС." /> }}
                                            />
                                            {(dynamics?.measures?.length ?? 0) > 0 && (
                                                <div>
                                                    <Text strong style={{ fontSize: 13 }}>
                                                        Меры по характеристикам (T-15: сопоставьте дату меры с трендом характеристики после неё — стало ли лучше):
                                                    </Text>
                                                    <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                                        {dynamics!.measures.map((m, i) => (
                                                            <Tag
                                                                key={i}
                                                                color={PROPOSAL_STATUS_TAG[m.status as ProposalStatus]?.color || 'default'}
                                                                style={{ padding: '4px 10px', fontSize: 12 }}
                                                            >
                                                                {m.characteristic} · {m.title} · {m.createdAt.slice(0, 10)} · {PROPOSAL_STATUS_TAG[m.status as ProposalStatus]?.label || m.status}
                                                            </Tag>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </Space>
                                    ),
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
                                        <Space wrap>
                                            <Select
                                                size="small"
                                                style={{ minWidth: 180 }}
                                                value={measureSystemFilter}
                                                onChange={setMeasureSystemFilter}
                                                options={[
                                                    { value: 'ALL', label: 'Все ИС' },
                                                    ...measureSystems.map((s) => ({ value: s, label: s })),
                                                ]}
                                            />
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
