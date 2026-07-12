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
    Alert, Button, Col, DatePicker, Empty, Form, Input, Modal, Row, Select, Space, Spin,
    Statistic, Table, Tag, Typography, message,
} from 'antd';
import { PlusOutlined, ThunderboltOutlined, ReloadOutlined, DatabaseOutlined, CalendarOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import ReactECharts from 'echarts-for-react';
import { useSelector } from 'react-redux';
import dayjs from 'dayjs';
import { RootState } from '../../store';
import {
    useCreateIncidentMutation,
    useGetIncidentsQuery,
    type TechIncidentDto,
} from '../../store/api/apiSlice';
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
};
const CATEGORY_COLOR: Record<string, string> = {
    RELEASE: '#7E57C2', INFRASTRUCTURE: '#6E89A6', PERFORMANCE: '#C9A14A', NETWORK: '#6F9F86', POWER: '#C06B5A',
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

    // Данные: live — из API; mock — демо-набор с локальной агрегацией.
    const liveList = useGetIncidentsQuery(undefined, { skip: !isLive });
    const liveAnalytics = useGetIncidentAnalyticsQuery(undefined, { skip: !isLive });
    const [createIncident, { isLoading: creating }] = useCreateIncidentMutation();

    const incidents = isLive ? (liveList.data ?? []) : MOCK_INCIDENTS;
    const analytics = isLive ? liveAnalytics.data : computeIncidentAnalytics(MOCK_INCIDENTS);
    const loading = isLive && (liveList.isFetching || liveAnalytics.isFetching);

    const [formOpen, setFormOpen] = useState(false);
    const [form] = Form.useForm();

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
            filters: INCIDENT_CATEGORIES.map((c) => ({ text: CATEGORY_LABEL[c], value: c })),
            onFilter: (v, r) => r.category === v,
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
                severity: v.severity,
                title: v.title,
                rootCause: v.rootCause,
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
                        {isLive && <Button icon={<ReloadOutlined />} onClick={() => { liveList.refetch(); liveAnalytics.refetch(); }}>Обновить</Button>}
                        {canManage && <Button type="primary" icon={<PlusOutlined />} onClick={() => setFormOpen(true)}>Зарегистрировать сбой</Button>}
                    </Space>
                </Col>
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

                    <div {...premiumCard()} style={{ padding: 16, marginTop: 16 }}>
                        <Text strong>Реестр технических сбоев ({incidents.length})</Text>
                        <Table
                            style={{ marginTop: 12 }}
                            size="small"
                            rowKey="id"
                            columns={columns}
                            dataSource={incidents}
                            pagination={{ pageSize: 10, hideOnSinglePage: true }}
                            scroll={{ x: 1000 }}
                            expandable={{
                                expandedRowRender: (r) => (
                                    <Space direction="vertical" size={2} style={{ fontSize: 13 }}>
                                        <Text type="secondary">Первопричина (описание): {r.rootCause || '—'}</Text>
                                        {r.releaseRef && <Text type="secondary">Релиз: {r.releaseRef}</Text>}
                                        <Text type="secondary">Восстановлен: {fmtDate(r.resolvedAt)}</Text>
                                    </Space>
                                ),
                            }}
                        />
                    </div>
                </>
            )}

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
                        <Col span={12}><Form.Item name="category" label="Первопричина" rules={[{ required: true }]}>
                            <Select options={INCIDENT_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))} placeholder="Категория" />
                        </Form.Item></Col>
                    </Row>
                    <Row gutter={12}>
                        <Col span={12}><Form.Item name="severity" label="Критичность"><Select options={Object.keys(SEVERITY_LABEL).map((s) => ({ value: s, label: SEVERITY_LABEL[s] }))} /></Form.Item></Col>
                        {category === 'RELEASE' && <Col span={12}><Form.Item name="releaseRef" label="Релиз/версия"><Input placeholder="напр. CRM 4.2.0" /></Form.Item></Col>}
                    </Row>
                    <Form.Item name="title" label="Краткое описание" rules={[{ required: true, message: 'Опишите сбой' }]}><Input placeholder="Что произошло" /></Form.Item>
                    <Form.Item name="rootCause" label="Первопричина (детально)"><Input.TextArea rows={2} placeholder="Корневая причина сбоя" /></Form.Item>
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
