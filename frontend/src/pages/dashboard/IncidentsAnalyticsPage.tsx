/**
 * IncidentsAnalyticsPage.tsx — «Аналитика технических сбоев» (T-21, новое бизнес-направление).
 *
 * Отдельный анализатор надёжности: распределение сбоев по первопричинам (релиз/инфраструктура/
 * производительность/сеть/электроснабжение), MTTR, доля привнесённых релизом, топ нестабильных ИС,
 * реестр сбоев. Для менеджера по качеству — с вводом; топ-менеджмент видит по флагу «Настройка».
 *
 * Источник данных по режиму (эталон governance): 'mock' — демо-набор (mockIncidents), 'live' — БД
 * через API /incidents. Не вмешивается в расчётный движок оценки качества.
 */
import React, { useMemo, useState } from 'react';
import {
    Alert, AutoComplete, Button, Col, DatePicker, Divider, Empty, Form, Input, Modal, Row, Select, Space, Spin,
    Statistic, Table, Tag, Typography, message,
} from 'antd';
import { PlusOutlined, ThunderboltOutlined, ReloadOutlined, DatabaseOutlined, CalendarOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import ReactECharts from 'echarts-for-react';
import { useSelector, shallowEqual } from 'react-redux';
import dayjs from 'dayjs';
import { RootState } from '../../store';
import {
    useCreateIncidentMutation,
    useGetIncidentsQuery,
    useGetIncidentCategoriesQuery,
    type TechIncidentDto,
} from '../../store/api/apiSlice';
import { selectVisibleProposals, type Proposal } from '../../store/slices/governanceSlice';
import { MOCK_INCIDENTS, INCIDENT_CATEGORIES, computeIncidentAnalytics } from '../../data/mockIncidents';
import { premiumCard, pageContainer, pageTitle, accentDot, accentColorOf } from '../../theme/premium';
import CollapsibleCard from '../../components/CollapsibleCard';
import { BRAND } from '../../theme/ragPalette';

const { Title, Text, Paragraph } = Typography;

const CATEGORY_LABEL: Record<string, string> = {
    RELEASE: 'Привнесено релизом',
    INFRASTRUCTURE: 'Инфраструктура',
    PERFORMANCE: 'Производительность',
    NETWORK: 'Сеть',
    POWER: 'Электроснабжение',
    OTHER: 'Другое',
};
const CATEGORY_COLOR: Record<string, string> = {
    RELEASE: '#7E57C2', INFRASTRUCTURE: '#6E89A6', PERFORMANCE: '#C9A14A', NETWORK: '#6F9F86', POWER: '#C06B5A', OTHER: '#8a94a6',
};
// Маппинг первопричины → характеристика ISO 25010 (зеркало backend CATEGORY_TO_CHARACTERISTIC) —
// для умного скоупинга связки «сбой ↔ мера» (T-42): предлагаем меры по связанной характеристике.
const CATEGORY_TO_CHARACTERISTIC: Record<string, string> = {
    RELEASE: 'Сопровождаемость', INFRASTRUCTURE: 'Надёжность', PERFORMANCE: 'Производительность',
    NETWORK: 'Надёжность', POWER: 'Надёжность', OTHER: 'Надёжность',
};
const norm = (s: string) => (s || '').toLowerCase().replace(/ё/g, 'е').replace(/[.\s]/g, '');
const SEVERITY_LABEL: Record<string, string> = { critical: 'критический', high: 'высокий', medium: 'средний', low: 'низкий' };
const SEVERITY_COLOR: Record<string, string> = { critical: 'red', high: 'volcano', medium: 'gold', low: 'blue' };

const fmtDate = (s?: string | null) => (s ? dayjs(s).format('DD.MM.YYYY HH:mm') : '—');
const mttrHours = (r: TechIncidentDto): number | null =>
    r.resolvedAt ? Math.round(((new Date(r.resolvedAt).getTime() - new Date(r.occurredAt).getTime()) / 3600000) * 10) / 10 : null;

const IncidentsAnalyticsPage: React.FC = () => {
    const dataMode = useSelector((s: RootState) => s.ui.dataMode);
    const role = useSelector((s: RootState) => s.auth.role) || '';
    const isLive = dataMode === 'live';
    const canManage = ['QUALITY_MANAGER', 'ADMIN'].includes(role);

    // Данные: live — из API (полный список), mock — демо-набор. Аналитика и реестр считаются
    // клиентски из ОТФИЛЬТРОВАННОГО набора (система T-39 + кварталы T-40) — единообразно в обоих
    // режимах (computeIncidentAnalytics — зеркало backend-агрегации).
    const liveList = useGetIncidentsQuery(undefined, { skip: !isLive });
    const [createIncident, { isLoading: creating }] = useCreateIncidentMutation();

    const allIncidents = isLive ? (liveList.data ?? []) : MOCK_INCIDENTS;
    const loading = isLive && liveList.isFetching;

    // Фильтры дашборда.
    const [systemFilter, setSystemFilter] = useState<string | undefined>(undefined);    // T-39
    const [quarterFilter, setQuarterFilter] = useState<string[]>([]);                    // T-40
    const [categoryFilter, setCategoryFilter] = useState<string | undefined>(undefined); // T-41 (реестр)
    const [selectedIncident, setSelectedIncident] = useState<TechIncidentDto | null>(null);

    const [formOpen, setFormOpen] = useState(false);
    const [form] = Form.useForm();

    // Ключ квартала возникновения (UTC): «Q{1..4}-{год}». Мультивыбор может пересекать границы лет.
    const quarterKeyOf = (iso: string) => {
        const d = new Date(iso);
        return `Q${Math.floor(d.getUTCMonth() / 3) + 1}-${d.getUTCFullYear()}`;
    };
    const quarterOrder = (k: string) => { const [q, y] = k.slice(1).split('-'); return Number(y) * 10 + Number(q); };

    const systemOptions = useMemo(
        () => [...new Set(allIncidents.map((r) => r.systemName))].sort().map((s) => ({ value: s, label: s })),
        [allIncidents],
    );
    const availableQuarters = useMemo(
        () => [...new Set(allIncidents.map((r) => quarterKeyOf(r.occurredAt)))].sort((a, b) => quarterOrder(a) - quarterOrder(b)),
        [allIncidents],
    );

    // Отфильтрованный набор (система + кварталы) — основа KPI/диаграмм/реестра.
    const filteredIncidents = useMemo(
        () => allIncidents.filter((r) =>
            (!systemFilter || r.systemName === systemFilter)
            && (quarterFilter.length === 0 || quarterFilter.includes(quarterKeyOf(r.occurredAt)))),
        [allIncidents, systemFilter, quarterFilter],
    );
    const analytics = useMemo(() => computeIncidentAnalytics(filteredIncidents), [filteredIncidents]);
    // Реестр — дополнительно фильтруется по первопричине (T-41).
    const registryRows = useMemo(
        () => (categoryFilter ? filteredIncidents.filter((r) => r.category === categoryFilter) : filteredIncidents),
        [filteredIncidents, categoryFilter],
    );

    const donutOption = useMemo(() => ({
        tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
        legend: { bottom: 0, icon: 'circle', textStyle: { color: BRAND.ink } },
        series: [{
            type: 'pie', radius: ['52%', '78%'], center: ['50%', '44%'], avoidLabelOverlap: true,
            itemStyle: { borderColor: '#fff', borderWidth: 2 },
            label: { show: false }, labelLine: { show: false },
            data: (analytics?.byCategory ?? []).map((c) => ({
                name: CATEGORY_LABEL[c.category] ?? c.category, value: c.count,
                itemStyle: { color: CATEGORY_COLOR[c.category] ?? '#8a94a6' },
            })),
        }],
    }), [analytics]);

    const columns: ColumnsType<TechIncidentDto> = [
        { title: 'ИС', dataIndex: 'systemName', width: 160, fixed: 'left' as const },
        {
            title: 'Первопричина', dataIndex: 'category', width: 180,
            render: (c: string) => <Tag color={CATEGORY_COLOR[c]} style={{ color: '#fff', border: 'none' }}>{CATEGORY_LABEL[c] ?? c}</Tag>,
        },
        {
            title: 'Критичность', dataIndex: 'severity', width: 120,
            render: (s: string) => <Tag color={SEVERITY_COLOR[s]}>{SEVERITY_LABEL[s] ?? s}</Tag>,
        },
        { title: 'Сбой', dataIndex: 'title', ellipsis: true },
        { title: 'Возник', dataIndex: 'occurredAt', width: 150, render: fmtDate },
        {
            title: 'Статус', key: 'status', width: 130,
            render: (_: unknown, r) => (r.resolvedAt
                ? <Tag color="green">восстановлен</Tag>
                : <Tag color="red">открыт</Tag>),
        },
        {
            title: 'MTTR, ч', key: 'mttr', width: 90,
            render: (_: unknown, r) => { const m = mttrHours(r); return m === null ? <Text type="secondary">—</Text> : <Text strong>{m}</Text>; },
        },
    ];

    const submit = async () => {
        try {
            const v = await form.validateFields();
            if (!isLive) {
                message.info('Ввод сбоев доступен в режиме LLM (реальная БД). В демо реестр — только для просмотра.');
                setFormOpen(false);
                return;
            }
            await createIncident({
                systemName: v.systemName,
                category: v.category,
                categoryCustom: v.category === 'OTHER' ? v.categoryCustom : undefined,
                severity: v.severity,
                title: v.title,
                rootCause: v.rootCause,
                admissionCause: v.admissionCause,
                responsibleUnit: v.responsibleUnit,
                preventiveMeasures: v.preventiveMeasures,
                linkedMeasureId: v.linkedMeasureId || null,
                releaseRef: v.releaseRef,
                occurredAt: (v.occurredAt as dayjs.Dayjs).toISOString(),
                resolvedAt: v.resolvedAt ? (v.resolvedAt as dayjs.Dayjs).toISOString() : null,
            }).unwrap();
            message.success('Сбой добавлен в реестр');
            setFormOpen(false);
            form.resetFields();
        } catch (e: any) {
            if (e?.data?.detail) message.error(e.data.detail);
        }
    };

    const category = Form.useWatch('category', form);
    const formSystem = Form.useWatch('systemName', form);

    // T-37: справочник первопричин (live) — базовые + ранее введённые пользовательские.
    const catQuery = useGetIncidentCategoriesQuery(undefined, { skip: !isLive });
    const rawCategoryOptions: { value: string; label: string }[] = catQuery.data?.base?.length
        ? catQuery.data.base.map((c) => ({ value: c.code, label: c.label }))
        : INCIDENT_CATEGORIES.map((c) => ({ value: c as string, label: CATEGORY_LABEL[c] }));
    const baseCategoryOptions = rawCategoryOptions
        .filter((o) => o.value !== 'OTHER')
        .concat({ value: 'OTHER', label: 'Другое…' });
    const customCategoryOptions = (catQuery.data?.custom ?? []).map((v) => ({ value: v }));

    // T-42: связка «сбой ↔ мера по улучшению качества». Скоуп по умолчанию — та же ИС +
    // характеристика, соответствующая первопричине (CATEGORY_TO_CHARACTERISTIC); поиск снимает скоуп.
    const proposals = useSelector(selectVisibleProposals, shallowEqual);
    const measureOptions = useMemo(() => {
        if (!formSystem) return [];
        const mappedChar = CATEGORY_TO_CHARACTERISTIC[category] ?? 'Надёжность';
        const sameSystem = proposals.filter((p) => norm(p.systemName) === norm(formSystem));
        const toOpt = (p: Proposal) => ({ value: p.id, label: `${p.riskTitle || p.metricName} · ${p.characteristic}` });
        const scoped = sameSystem.filter((p) => norm(p.characteristic) === norm(mappedChar)).map(toOpt);
        const rest = sameSystem.filter((p) => norm(p.characteristic) !== norm(mappedChar)).map(toOpt);
        return [
            ...(scoped.length ? [{ label: `Рекомендуемые по «${mappedChar}»`, options: scoped }] : []),
            ...(rest.length ? [{ label: 'Другие меры этой ИС', options: rest }] : []),
        ];
    }, [proposals, formSystem, category]);

    // Название связанной меры для карточки сбоя (T-42).
    const measureTitleById = (id?: string | null) => {
        if (!id) return null;
        const p = proposals.find((x) => x.id === id);
        return p ? `${p.riskTitle || p.metricName} · ${p.characteristic}` : id;
    };

    return (
        <div style={pageContainer}>
            <Row align="middle" justify="space-between" style={{ marginBottom: 16 }}>
                <Col>
                    <Title level={3} style={pageTitle}>
                        <span style={accentDot(accentColorOf('terracotta')!)} />
                        Аналитика технических сбоев
                    </Title>
                    <Text type="secondary">
                        Надёжность ИТ-ландшафта по первопричинам · {dataMode === 'mock' ? 'демо-данные' : 'реальная БД'}
                    </Text>
                </Col>
                <Col>
                    <Space>
                        {isLive && <Button icon={<ReloadOutlined />} onClick={() => liveList.refetch()}>Обновить</Button>}
                        {canManage && <Button type="primary" icon={<PlusOutlined />} onClick={() => setFormOpen(true)}>Зарегистрировать сбой</Button>}
                    </Space>
                </Col>
            </Row>

            {/* Фильтры верхнего уровня: система (T-39) и кварталы (T-40) — влияют на KPI, диаграммы и реестр. */}
            <Row gutter={[12, 12]} align="middle" style={{ marginBottom: 16 }} wrap>
                <Col><Text type="secondary"><DatabaseOutlined /> Система:</Text></Col>
                <Col flex="0 1 280px">
                    <Select
                        allowClear showSearch optionFilterProp="label" style={{ width: '100%' }}
                        placeholder="Все системы" value={systemFilter} onChange={setSystemFilter} options={systemOptions}
                    />
                </Col>
                <Col><Text type="secondary"><CalendarOutlined /> Период (кварталы):</Text></Col>
                <Col flex="1 1 320px">
                    <Select
                        mode="multiple" allowClear style={{ width: '100%' }} maxTagCount="responsive"
                        placeholder="Все периоды — можно выбрать несколько кварталов разных лет"
                        value={quarterFilter} onChange={setQuarterFilter}
                        options={availableQuarters.map((q) => ({ value: q, label: q }))}
                    />
                </Col>
                {(systemFilter || quarterFilter.length > 0) && (
                    <Col><Button size="small" type="link" onClick={() => { setSystemFilter(undefined); setQuarterFilter([]); }}>Сбросить фильтры</Button></Col>
                )}
            </Row>

            {loading ? <div style={{ textAlign: 'center', padding: 48 }}><Spin size="large" /></div> : (
                <>
                    <Row gutter={[16, 16]}>
                        <Col xs={12} md={6}><div {...premiumCard()}><Statistic title="Всего сбоев" value={analytics?.total ?? 0} /></div></Col>
                        <Col xs={12} md={6}><div {...premiumCard()}><Statistic title="Открыто (не восстановлены)" value={analytics?.openCount ?? 0} valueStyle={{ color: (analytics?.openCount ?? 0) > 0 ? '#C06B5A' : undefined }} /></div></Col>
                        <Col xs={12} md={6}><div {...premiumCard()}><Statistic title="Средний MTTR, ч" value={analytics?.avgMttrHours ?? 0} precision={1} /></div></Col>
                        <Col xs={12} md={6}><div {...premiumCard()}><Statistic title="Из-за релизов, %" value={analytics?.releaseInducedShare ?? 0} precision={1} suffix="%" /></div></Col>
                    </Row>

                    <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
                        <Col xs={24} md={10}>
                            <div {...premiumCard('terracotta')} style={{ padding: 16 }}>
                                <Text strong><ThunderboltOutlined /> Распределение по первопричинам</Text>
                                {analytics && analytics.total > 0
                                    ? <ReactECharts option={donutOption} style={{ height: 300 }} />
                                    : <Empty description="Сбоев не зафиксировано" style={{ padding: 40 }} />}
                            </div>
                        </Col>
                        <Col xs={24} md={14}>
                            <div {...premiumCard()} style={{ padding: 16 }}>
                                <Text strong>Первопричины: частота, доля, среднее время восстановления</Text>
                                <Table
                                    style={{ marginTop: 12 }}
                                    size="small"
                                    pagination={false}
                                    rowKey="category"
                                    dataSource={analytics?.byCategory ?? []}
                                    columns={[
                                        { title: 'Первопричина', dataIndex: 'category', render: (c: string) => <Tag color={CATEGORY_COLOR[c]} style={{ color: '#fff', border: 'none' }}>{CATEGORY_LABEL[c] ?? c}</Tag> },
                                        { title: 'Сбоев', dataIndex: 'count', width: 80 },
                                        { title: 'Доля', dataIndex: 'share', width: 90, render: (v: number) => `${v}%` },
                                        { title: 'Открыто', dataIndex: 'openCount', width: 90 },
                                        { title: 'MTTR, ч', dataIndex: 'avgMttrHours', width: 90, render: (v: number | null) => (v === null ? '—' : v) },
                                    ]}
                                />
                                <div style={{ marginTop: 16 }}>
                                    <Text strong>Топ нестабильных ИС</Text>
                                    <Space wrap style={{ marginTop: 8 }}>
                                        {(analytics?.topSystems ?? []).map((s) => (
                                            <Tag key={s.systemName} style={{ padding: '4px 10px', fontSize: 13 }}>
                                                {s.systemName}: <b>{s.count}</b>{s.openCount > 0 && <span style={{ color: '#C06B5A' }}> · открыто {s.openCount}</span>}
                                            </Tag>
                                        ))}
                                    </Space>
                                </div>
                            </div>
                        </Col>
                    </Row>

                    <CollapsibleCard
                        accent="ink"
                        style={{ marginTop: 16 }}
                        defaultOpen
                        title={`Реестр технических сбоев (${registryRows.length})`}
                        subtitle="Клик по строке — карточка сбоя. Свернуть/раскрыть — кнопкой слева."
                        extra={(
                            <Space>
                                <Text type="secondary" style={{ fontSize: 12 }}>Первопричина:</Text>
                                <Select
                                    allowClear size="small" style={{ minWidth: 210 }} placeholder="Все первопричины"
                                    value={categoryFilter} onChange={setCategoryFilter}
                                    options={INCIDENT_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))}
                                />
                            </Space>
                        )}
                    >
                        <Table
                            size="small"
                            rowKey="id"
                            columns={columns}
                            dataSource={registryRows}
                            pagination={{ pageSize: 10, hideOnSinglePage: true }}
                            scroll={{ x: 1000 }}
                            onRow={(r) => ({ onClick: () => setSelectedIncident(r), style: { cursor: 'pointer' } })}
                        />
                    </CollapsibleCard>
                </>
            )}

            {/* Карточка сбоя — открывается кликом по строке реестра (T-41). */}
            <Modal
                open={!!selectedIncident}
                title="Карточка технического сбоя"
                footer={null}
                onCancel={() => setSelectedIncident(null)}
                width={640}
            >
                {selectedIncident && (
                    <Space direction="vertical" size={10} style={{ width: '100%' }}>
                        <Space wrap>
                            <Tag color={CATEGORY_COLOR[selectedIncident.category]} style={{ color: '#fff', border: 'none' }}>
                                {CATEGORY_LABEL[selectedIncident.category] ?? selectedIncident.category}
                            </Tag>
                            <Tag color={SEVERITY_COLOR[selectedIncident.severity]}>
                                {SEVERITY_LABEL[selectedIncident.severity] ?? selectedIncident.severity}
                            </Tag>
                            {selectedIncident.resolvedAt ? <Tag color="green">восстановлен</Tag> : <Tag color="red">открыт</Tag>}
                        </Space>
                        <Title level={5} style={{ margin: 0 }}>{selectedIncident.title}</Title>
                        <Row gutter={[12, 8]}>
                            <Col span={12}><Text type="secondary">ИС: </Text><Text strong>{selectedIncident.systemName}</Text></Col>
                            <Col span={12}><Text type="secondary">MTTR: </Text><Text strong>{(() => { const m = mttrHours(selectedIncident); return m === null ? '—' : `${m} ч`; })()}</Text></Col>
                            <Col span={12}><Text type="secondary">Возник: </Text>{fmtDate(selectedIncident.occurredAt)}</Col>
                            <Col span={12}><Text type="secondary">Восстановлен: </Text>{fmtDate(selectedIncident.resolvedAt)}</Col>
                            {selectedIncident.releaseRef && <Col span={24}><Text type="secondary">Релиз/версия: </Text>{selectedIncident.releaseRef}</Col>}
                        </Row>
                        {selectedIncident.category === 'OTHER' && selectedIncident.categoryCustom && (
                            <div><Text type="secondary">Первопричина (уточнение): </Text><Text>{selectedIncident.categoryCustom}</Text></div>
                        )}
                        <div>
                            <Text type="secondary">Корневая причина:</Text>
                            <Paragraph style={{ marginBottom: 0 }}>{selectedIncident.rootCause || '—'}</Paragraph>
                        </div>
                        <div>
                            <Text type="secondary">Причина допущения:</Text>
                            <Paragraph style={{ marginBottom: 0 }}>{selectedIncident.admissionCause || '—'}</Paragraph>
                        </div>
                        <Row gutter={[12, 8]}>
                            <Col span={12}><Text type="secondary">Виновное направление: </Text><Text>{selectedIncident.responsibleUnit || '—'}</Text></Col>
                            <Col span={12}><Text type="secondary">Связанная мера: </Text><Text>{measureTitleById(selectedIncident.linkedMeasureId) || '—'}</Text></Col>
                        </Row>
                        <div>
                            <Text type="secondary">Меры по неповторению:</Text>
                            <Paragraph style={{ marginBottom: 0 }}>{selectedIncident.preventiveMeasures || '—'}</Paragraph>
                        </div>
                    </Space>
                )}
            </Modal>

            <Modal
                open={formOpen}
                title="Регистрация технического сбоя"
                okText="Добавить"
                cancelText="Отмена"
                confirmLoading={creating}
                onOk={submit}
                onCancel={() => setFormOpen(false)}
                width={640}
            >
                {!isLive && <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Демо-режим: ввод сохранится только в режиме LLM (реальная БД)." />}
                <Form form={form} layout="vertical" initialValues={{ severity: 'medium', occurredAt: dayjs() }}>
                    <Row gutter={12}>
                        <Col span={12}><Form.Item name="systemName" label="ИС" rules={[{ required: true, message: 'Укажите систему' }]}><Input placeholder="напр. АБС Core" /></Form.Item></Col>
                        <Col span={12}><Form.Item name="category" label="Первопричина" rules={[{ required: true, message: 'Выберите первопричину' }]}>
                            <Select options={baseCategoryOptions} placeholder="Категория" />
                        </Form.Item></Col>
                    </Row>
                    {category === 'OTHER' && (
                        <Form.Item name="categoryCustom" label="Новая первопричина" rules={[{ required: true, message: 'Укажите новую первопричину' }]}>
                            <AutoComplete
                                options={customCategoryOptions}
                                placeholder="напр. человеческий фактор"
                                filterOption={(inp, opt) => String(opt?.value ?? '').toLowerCase().includes(inp.toLowerCase())}
                            />
                        </Form.Item>
                    )}
                    <Row gutter={12}>
                        <Col span={12}><Form.Item name="severity" label="Критичность"><Select options={Object.keys(SEVERITY_LABEL).map((s) => ({ value: s, label: SEVERITY_LABEL[s] }))} /></Form.Item></Col>
                        {category === 'RELEASE' && <Col span={12}><Form.Item name="releaseRef" label="Релиз/версия"><Input placeholder="напр. CRM 4.2.0" /></Form.Item></Col>}
                    </Row>
                    <Form.Item name="title" label="Краткое описание" rules={[{ required: true, message: 'Опишите сбой' }]}><Input placeholder="Что произошло" /></Form.Item>

                    <Divider style={{ margin: '4px 0 12px' }} orientation="left" plain><Text type="secondary" style={{ fontSize: 12 }}>Обязательный разбор</Text></Divider>
                    <Form.Item name="rootCause" label="Корневая причина" rules={[{ required: true, message: 'Укажите корневую причину' }]}><Input.TextArea rows={2} placeholder="Что стало непосредственной причиной сбоя" /></Form.Item>
                    <Form.Item name="admissionCause" label="Причина допущения" rules={[{ required: true, message: 'Укажите причину допущения' }]}><Input.TextArea rows={2} placeholder="Почему сбой стал возможен — что не сработало в контроле" /></Form.Item>
                    <Row gutter={12}>
                        <Col span={12}><Form.Item name="responsibleUnit" label="Виновное направление производства" rules={[{ required: true, message: 'Укажите направление' }]}><Input placeholder="напр. Разработка CRM" /></Form.Item></Col>
                        <Col span={12}><Form.Item name="linkedMeasureId" label="Связанная мера по улучшению качества" tooltip="Предлагаются меры этой ИС по характеристике, связанной с первопричиной; поиск ищет среди всех мер ИС">
                            <Select allowClear showSearch optionFilterProp="label" placeholder={formSystem ? 'Подобрать меру…' : 'Сначала укажите ИС'} options={measureOptions} notFoundContent="Мер по этой ИС нет" />
                        </Form.Item></Col>
                    </Row>
                    <Form.Item name="preventiveMeasures" label="Меры по неповторению" rules={[{ required: true, message: 'Укажите меры по неповторению' }]}><Input.TextArea rows={2} placeholder="Что сделать, чтобы сбой не повторился" /></Form.Item>

                    <Row gutter={12}>
                        <Col span={12}><Form.Item name="occurredAt" label="Возник" rules={[{ required: true }]}><DatePicker showTime style={{ width: '100%' }} format="DD.MM.YYYY HH:mm" /></Form.Item></Col>
                        <Col span={12}><Form.Item name="resolvedAt" label="Восстановлен (если закрыт)"><DatePicker showTime style={{ width: '100%' }} format="DD.MM.YYYY HH:mm" /></Form.Item></Col>
                    </Row>
                </Form>
            </Modal>
        </div>
    );
};

export default IncidentsAnalyticsPage;
