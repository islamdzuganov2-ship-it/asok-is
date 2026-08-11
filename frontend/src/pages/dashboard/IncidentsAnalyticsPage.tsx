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
    Alert, Button, Card, Col, Empty, Modal, Row, Select, Space, Spin,
    Table, Tag, Typography,
} from 'antd';
import {
    ThunderboltOutlined, ReloadOutlined, DatabaseOutlined, CalendarOutlined,
    UploadOutlined, ApiOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import ReactECharts from 'echarts-for-react';
import { useSelector, shallowEqual } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { RootState } from '../../store';
import {
    useGetIncidentsQuery,
    useCreateIncidentMutation,
    useGetIncidentCategoriesQuery,
    type TechIncidentDto,
} from '../../store/api/apiSlice';
import { selectVisibleProposals } from '../../store/slices/governanceSlice';
import { MOCK_INCIDENTS, INCIDENT_CATEGORIES, computeIncidentAnalytics } from '../../data/mockIncidents';
import { premiumCard, pageContainer, pageTitle, accentDot, accentColorOf, SPACE, TYPE } from '../../theme/premium';
import CollapsibleCard from '../../components/CollapsibleCard';
import KpiCard from '../../components/KpiCard';
import { BRAND, RAG, solidTagStyle, ACCENT } from '../../theme/ragPalette';
import { useChartTokens } from '../../theme/useThemeTokens';
import { numericColumn, numericText } from '../../theme/table';

const { Title, Text, Paragraph } = Typography;

const CATEGORY_LABEL: Record<string, string> = {
    RELEASE: 'Привнесено релизом',
    INFRASTRUCTURE: 'Инфраструктура',
    PERFORMANCE: 'Производительность',
    NETWORK: 'Сеть',
    POWER: 'Электроснабжение',
    OTHER: 'Другое',
};
// Цвет первопричины в ГРАФИКЕ (сектора/столбцы) — ≥3:1 с белым (WCAG 1.4.11).
const CATEGORY_COLOR: Record<string, string> = {
    RELEASE: ACCENT.violet.color, INFRASTRUCTURE: ACCENT.slate.color, PERFORMANCE: '#B88E32', NETWORK: RAG.good.color, POWER: RAG.bad.color, OTHER: RAG.muted.color,
};
// Тот же оттенок для ПЛАШКИ с белым текстом — углублён до ≥4.5:1 (T-57).
const CATEGORY_TAG_COLOR: Record<string, string> = {
    RELEASE: ACCENT.violet.color, INFRASTRUCTURE: ACCENT.slate.strong, PERFORMANCE: '#947125', NETWORK: '#4C8165', POWER: '#C0553F', OTHER: '#667797',
};
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
    const navigate = useNavigate();

    const allIncidents = isLive ? (liveList.data ?? []) : MOCK_INCIDENTS;
    const loading = isLive && liveList.isFetching;

    // Фильтры дашборда.
    const [systemFilter, setSystemFilter] = useState<string | undefined>(undefined);    // T-39
    const [quarterFilter, setQuarterFilter] = useState<string[]>([]);                    // T-40
    const [categoryFilter, setCategoryFilter] = useState<string | undefined>(undefined); // T-41 (реестр)
    const [selectedIncident, setSelectedIncident] = useState<TechIncidentDto | null>(null);

    // Ключ квартала возникновения (UTC): «Q{1..4}-{год}». Мультивыбор может пересекать границы лет.
    const quarterKeyOf = (iso: string) => {
        const d = new Date(iso);
        return `Q${Math.floor(d.getUTCMonth() / 3) + 1}-${d.getUTCFullYear()}`;
    };
    const quarterOrder = (k: string) => { const [q, y] = k.slice(1).split('-'); return Number(y) * 10 + Number(q); };

    // ECharts (canvas) не понимает var() — берём конкретные цвета активной темы.
    const chart = useChartTokens();

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
        // confine: true — всплывашка не должна вылезать за контейнер и обрезаться (UI-15).
        tooltip: { trigger: 'item', confine: true, formatter: '{b}: {c} ({d}%)' },
        legend: { bottom: 0, icon: 'circle', textStyle: { color: chart.ink } },
        series: [{
            type: 'pie', radius: ['52%', '78%'], center: ['50%', '44%'], avoidLabelOverlap: true,
            itemStyle: { borderColor: '#fff', borderWidth: 2 },
            label: { show: false }, labelLine: { show: false },
            data: (analytics?.byCategory ?? []).map((c) => ({
                name: CATEGORY_LABEL[c.category] ?? c.category, value: c.count,
                itemStyle: { color: CATEGORY_COLOR[c.category] ?? RAG.muted.color },
            })),
        }],
    }), [analytics, chart.ink]);

    const columns: ColumnsType<TechIncidentDto> = [
        { title: 'ИС', dataIndex: 'systemName', width: 160, fixed: 'left' as const },
        {
            title: 'Первопричина', dataIndex: 'category', width: 180,
            render: (c: string) => <Tag style={solidTagStyle(CATEGORY_TAG_COLOR[c])}>{CATEGORY_LABEL[c] ?? c}</Tag>,
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

    // Связь «сбой ↔ мера» показывается в карточке сбоя (реестр — только чтение). Меры берём из
    // governance-набора по текущему режиму данных.
    const proposals = useSelector(selectVisibleProposals, shallowEqual);

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
                        {canManage && (
                            <Button type="primary" icon={<UploadOutlined />} onClick={() => navigate('/assessments/new?tab=upload-incidents')}>
                                Загрузить сбои из Excel
                            </Button>
                        )}
                    </Space>
                </Col>
            </Row>

            {/* Источник сбоев: только авто-выгрузка из ITSM и загрузка из Excel/CSV. Ручная регистрация
                убрана — оператор не заводит сбои по одному, данные поступают из внешних систем. */}
            <Alert
                type="info"
                showIcon
                icon={<ApiOutlined />}
                style={{ marginBottom: 16 }}
                message="Сбои поступают автоматически из ITSM и загрузкой из Excel/CSV"
                description={canManage
                    ? 'Ручная регистрация сбоя по одному отключена. Технические сбои синхронизируются из ITSM и/или загружаются пакетом через «Загрузка ТС» (кнопка «Загрузить сбои из Excel»).'
                    : 'Технические сбои синхронизируются из ITSM и загружаются пакетом из Excel/CSV. Реестр ниже — только для просмотра и анализа.'}
            />

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
                        {/* Ряд KPI — общий компонент: раньше это был голый <div> с разлитым
                            premiumCard(), из-за чего в DOM уходил невалидный проп `styles`,
                            а плитки отличались от таких же на аналитическом дашборде (UI-12). */}
                        <Col xs={12} md={6}><KpiCard title="Всего сбоев" value={analytics?.total ?? 0} /></Col>
                        <Col xs={12} md={6}>
                            <KpiCard
                                title="Открыто (не восстановлены)"
                                value={analytics?.openCount ?? 0}
                                color={(analytics?.openCount ?? 0) > 0 ? RAG.bad.strong : undefined}
                            />
                        </Col>
                        <Col xs={12} md={6}><KpiCard title="Средний MTTR, ч" value={(analytics?.avgMttrHours ?? 0).toFixed(1)} /></Col>
                        <Col xs={12} md={6}><KpiCard title="Из-за релизов, %" value={`${(analytics?.releaseInducedShare ?? 0).toFixed(1)} %`} /></Col>
                    </Row>

                    <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
                        {/* Раньше здесь был <div {...premiumCard()} style={{padding:16}}>: свой
                            `style` ПОСЛЕ спреда затирал стиль карточки целиком, поэтому блоки
                            лежали на полотне без фона, рамки и тени, а невалидный проп `styles`
                            уходил в DOM. Это настоящая карточка (UI-14). */}
                        <Col xs={24} md={10}>
                            <Card
                                {...premiumCard('terracotta')}
                                title={(
                                    <Space>
                                        <span style={accentDot(accentColorOf('terracotta')!)} />
                                        <span style={{ color: BRAND.ink }}>Распределение по первопричинам</span>
                                    </Space>
                                )}
                            >
                                {analytics && analytics.total > 0
                                    ? <ReactECharts option={donutOption} style={{ height: 300 }} />
                                    : <Empty description="Сбоев не зафиксировано" style={{ padding: SPACE.page }} />}
                            </Card>
                        </Col>
                        <Col xs={24} md={14}>
                            <Card
                                {...premiumCard('slate')}
                                title={(
                                    <Space>
                                        <span style={accentDot(accentColorOf('slate')!)} />
                                        <span style={{ color: BRAND.ink }}>Первопричины: частота, доля, среднее время восстановления</span>
                                    </Space>
                                )}
                            >
                                <Table
                                    size="small"
                                    pagination={false}
                                    rowKey="category"
                                    // Пять колонок не влезают в половину ряда на планшете
                                    // (768px: переполнение 119px) — скроллим таблицу, не страницу.
                                    scroll={{ x: 520 }}
                                    locale={{ emptyText: 'За выбранный период сбоев не зарегистрировано' }}
                                    dataSource={analytics?.byCategory ?? []}
                                    columns={[
                                        { title: 'Первопричина', dataIndex: 'category', render: (c: string) => <Tag style={solidTagStyle(CATEGORY_TAG_COLOR[c])}>{CATEGORY_LABEL[c] ?? c}</Tag> },
                                        numericColumn({ title: 'Сбоев', dataIndex: 'count', width: 80 }),
                                        numericColumn({ title: 'Доля', dataIndex: 'share', width: 90, render: (v: number) => `${v}%` }),
                                        numericColumn({ title: 'Открыто', dataIndex: 'openCount', width: 90 }),
                                        numericColumn({ title: 'MTTR, ч', dataIndex: 'avgMttrHours', width: 90, render: (v: number | null) => (v === null ? '—' : v) }),
                                    ]}
                                />
                                <div style={{ marginTop: SPACE.base }}>
                                    <Text strong>Топ нестабильных ИС</Text>
                                    <Space wrap style={{ marginTop: SPACE.snug }}>
                                        {(analytics?.topSystems ?? []).map((s) => (
                                            <Tag key={s.systemName} style={{ padding: `${SPACE.tight}px ${SPACE.cozy}px`, ...TYPE.bodySm }}>
                                                {s.systemName}: <b style={numericText}>{s.count}</b>
                                                {s.openCount > 0 && <span style={{ color: RAG.bad.strong }}> · открыто {s.openCount}</span>}
                                            </Tag>
                                        ))}
                                    </Space>
                                </div>
                            </Card>
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
                                <Text type="secondary" style={{ fontSize: TYPE.caption.fontSize }}>Первопричина:</Text>
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
                            <Tag style={solidTagStyle(CATEGORY_TAG_COLOR[selectedIncident.category])}>
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
        </div>
    );
};

export default IncidentsAnalyticsPage;
