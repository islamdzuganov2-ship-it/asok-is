/**
 * RiskRadarPage.tsx — «Риск-радар» (T-16): проактивная защита от технического сбоя.
 *
 * Показывает риски из базы, которые МОГУТ РЕАЛИЗОВАТЬСЯ по текущему состоянию ИС: частые техсбои
 * по первопричинам (маппинг категория → характеристика ISO) и/или просевшие характеристики.
 * Реализует пункт бизнес-видения «работа с рисками по недопущению техсбоя». Источник — backend
 * GET /risks/triggered (риски + пояснение, ЧЕМ сработал каждый). Аналитика реальной БД —
 * не зависит от переключателя Демо/LLM.
 */
import React, { useMemo, useState } from 'react';
import { Alert, Col, Empty, List, Row, Select, Space, Spin, Tag, Typography } from 'antd';
import { AlertOutlined, SafetyCertificateOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { useGetSystemsQuery, useGetTriggeredRisksQuery } from '../../store/api/apiSlice';
import { premiumCard, pageContainer, pageTitle, accentDot, accentColorOf } from '../../theme/premium';

const { Title, Text, Paragraph } = Typography;

const SEVERITY: Record<string, { label: string; color: string; order: number }> = {
    critical: { label: 'критический', color: '#C0392B', order: 0 },
    high: { label: 'высокий', color: '#C06B5A', order: 1 },
    medium: { label: 'средний', color: '#C9A14A', order: 2 },
    low: { label: 'низкий', color: '#6E89A6', order: 3 },
};

const RiskRadarPage: React.FC = () => {
    const { data: systems } = useGetSystemsQuery();
    const [system, setSystem] = useState<string | undefined>(undefined);
    const { data: risks, isFetching } = useGetTriggeredRisksQuery(system ? { system } : undefined);

    const sorted = useMemo(
        () => [...(risks ?? [])].sort(
            (a, b) => (SEVERITY[a.severity]?.order ?? 9) - (SEVERITY[b.severity]?.order ?? 9),
        ),
        [risks],
    );

    const systemOptions = [
        { value: '', label: 'Весь ИТ-ландшафт' },
        ...(systems?.items ?? []).map((s) => ({ value: s.name, label: s.name })),
    ];

    return (
        <div style={pageContainer}>
            <Row align="middle" justify="space-between" style={{ marginBottom: 16 }}>
                <Col>
                    <Title level={3} style={pageTitle}>
                        <span style={accentDot(accentColorOf('terracotta')!)} />
                        Риск-радар — проактивная защита от техсбоя
                    </Title>
                    <Text type="secondary">
                        Риски из базы, которые могут реализоваться по текущему состоянию (частые техсбои + просевшие характеристики)
                    </Text>
                </Col>
                <Col>
                    <Select
                        style={{ minWidth: 240 }}
                        value={system ?? ''}
                        onChange={(v) => setSystem(v || undefined)}
                        options={systemOptions}
                        placeholder="Система"
                    />
                </Col>
            </Row>

            <Alert
                type="warning"
                showIcon
                icon={<SafetyCertificateOutlined />}
                style={{ marginBottom: 16 }}
                message="Как читать радар"
                description="Каждый риск ниже «сработал» по фактам: техсбои определённой первопричины или просадка характеристики повышают вероятность его реализации. Приоритет — критические и высокие. Меры минимизации — из базы рисков (без выдумывания)."
            />

            {isFetching ? (
                <div style={{ textAlign: 'center', padding: 48 }}><Spin size="large" /></div>
            ) : sorted.length === 0 ? (
                <div {...premiumCard()} style={{ padding: 40 }}>
                    <Empty description="Активных риск-триггеров нет — по текущим данным риски из базы не сработали." />
                </div>
            ) : (
                <div {...premiumCard()} style={{ padding: 8 }}>
                    <List
                        itemLayout="vertical"
                        dataSource={sorted}
                        renderItem={(r) => {
                            const sev = SEVERITY[r.severity] ?? { label: r.severity, color: '#8a94a6', order: 9 };
                            return (
                                <List.Item key={r.id} style={{ borderLeft: `3px solid ${sev.color}`, paddingLeft: 14, marginBottom: 4 }}>
                                    <Space direction="vertical" size={4} style={{ width: '100%' }}>
                                        <Space wrap>
                                            <Tag color={sev.color} style={{ color: '#fff', border: 'none' }}>{sev.label}</Tag>
                                            {r.characteristic && <Tag>{r.characteristic}</Tag>}
                                            <Text strong>{r.title}</Text>
                                            <Text type="secondary" style={{ fontSize: 12 }}>({r.code})</Text>
                                        </Space>
                                        <Space size={6} align="start">
                                            <ThunderboltOutlined style={{ color: '#C06B5A', marginTop: 3 }} />
                                            <Text style={{ fontSize: 13 }}>
                                                <Text type="secondary">Сработал по: </Text>{r.triggered_by}
                                            </Text>
                                        </Space>
                                        {r.consequence && (
                                            <Text type="secondary" style={{ fontSize: 13 }}>
                                                <AlertOutlined /> Последствие: {r.consequence}
                                            </Text>
                                        )}
                                        {r.mitigation && (
                                            <Paragraph style={{ fontSize: 13, marginBottom: 0, background: '#FAFBFC', padding: '6px 10px', borderRadius: 8 }}>
                                                <Text strong style={{ fontSize: 12 }}>Меры минимизации: </Text>{r.mitigation}
                                            </Paragraph>
                                        )}
                                    </Space>
                                </List.Item>
                            );
                        }}
                    />
                </div>
            )}
        </div>
    );
};

export default RiskRadarPage;
