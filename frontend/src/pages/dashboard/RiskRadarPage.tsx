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
import { Alert, Card, Col, Empty, List, Row, Select, Space, Spin, Tag, Typography } from 'antd';
import { AlertOutlined, SafetyCertificateOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { useGetSystemsQuery, useGetTriggeredRisksQuery } from '../../store/api/apiSlice';
import { premiumCard, pageContainer, pageTitle, accentDot, accentColorOf, SPACE, TYPE, PREMIUM } from '../../theme/premium';
import { RAG, solidTagStyle, ACCENT } from '../../theme/ragPalette';

const { Title, Text, Paragraph } = Typography;

// Плашка критичности — с белым текстом, поэтому тона глубокие (≥4.5:1 с белым, T-57).
const SEVERITY: Record<string, { label: string; color: string; order: number }> = {
    critical: { label: 'критический', color: '#A32B1F', order: 0 },
    high: { label: 'высокий', color: RAG.bad.strong, order: 1 },
    medium: { label: 'средний', color: RAG.medium.strong, order: 2 },
    low: { label: 'низкий', color: ACCENT.slate.strong, order: 3 },
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
                message="Зачем нужен этот раздел"
                description="Радар отбирает из базы риски, которые уже показывают признаки скорой реализации — по двум сигналам: (1) частые технические сбои по одной и той же первопричине в этой ИС, (2) просевшие характеристики качества ISO 25010, связанные с риском. Список строится напрямую по данным БД (не LLM) и не зависит от переключателя Демо/LLM — это не аналитика «по настроению», а факт срабатывания. Мера минимизации по каждому риску берётся из справочника рисков, а не придумывается на лету. Приоритет для реагирования — критические и высокие."
            />

            {isFetching ? (
                <div style={{ textAlign: 'center', padding: 48 }}><Spin size="large" /></div>
            ) : sorted.length === 0 ? (
                // Свой `style` после спреда затирал стиль карточки целиком — блок оставался
                // без фона, рамки и тени, а невалидный `styles` уходил в DOM (UI-14).
                <Card {...premiumCard('slate')}>
                    <Empty description="Активных риск-триггеров нет — по текущим данным риски из базы не сработали." />
                </Card>
            ) : (
                <Card {...premiumCard('slate')}>
                    <List
                        itemLayout="vertical"
                        dataSource={sorted}
                        renderItem={(r) => {
                            const sev = SEVERITY[r.severity] ?? { label: r.severity, color: RAG.muted.strong, order: 9 };
                            return (
                                <List.Item key={r.id} style={{ borderLeft: `3px solid ${sev.color}`, paddingLeft: SPACE.base, marginBottom: SPACE.tight }}>
                                    <Space direction="vertical" size={4} style={{ width: '100%' }}>
                                        <Space wrap>
                                            <Tag style={solidTagStyle(sev.color)}>{sev.label}</Tag>
                                            {r.characteristic && <Tag>{r.characteristic}</Tag>}
                                            <Text strong>{r.title}</Text>
                                            <Text type="secondary" style={{ fontSize: TYPE.caption.fontSize }}>({r.code})</Text>
                                        </Space>
                                        <Space size={6} align="start">
                                            {/* ui-audit-ignore UI-05 — оптическая подгонка иконки
                                                под базовую линию текста; сетка её раскосит. */}
                                            <ThunderboltOutlined style={{ color: RAG.bad.color, marginTop: 3 }} />
                                            <Text style={{ fontSize: TYPE.bodySm.fontSize }}>
                                                <Text type="secondary">Сработал по: </Text>{r.triggered_by}
                                            </Text>
                                        </Space>
                                        {r.consequence && (
                                            <Text type="secondary" style={{ fontSize: TYPE.bodySm.fontSize }}>
                                                <AlertOutlined /> Последствие: {r.consequence}
                                            </Text>
                                        )}
                                        {r.mitigation && (
                                            <Paragraph style={{
                                                ...TYPE.bodySm, marginBottom: 0,
                                                background: PREMIUM.surfaceSoft,
                                                padding: `${SPACE.snug}px ${SPACE.cozy}px`,
                                                borderRadius: PREMIUM.radiusSm,
                                            }}>
                                                <Text strong style={TYPE.captionStrong}>Меры минимизации: </Text>{r.mitigation}
                                            </Paragraph>
                                        )}
                                    </Space>
                                </List.Item>
                            );
                        }}
                    />
                </Card>
            )}
        </div>
    );
};

export default RiskRadarPage;
