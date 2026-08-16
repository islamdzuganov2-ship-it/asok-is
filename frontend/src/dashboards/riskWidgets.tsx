/**
 * riskWidgets.tsx (BL-008, Фаза 4) — реестр виджетов дашборда владельца риска (dashboardKey="risk").
 * Каждый виджет самодостаточен (сам тянет данные через RTK Query; запросы дедуплицируются).
 * Используется DashboardShell: пользователь включает/выключает и переставляет их под себя.
 */
import React from 'react';
import { Card, Col, Row, Typography, Tag, List, Statistic, Empty, Spin, Space, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  SafetyCertificateOutlined, ThunderboltOutlined, AlertOutlined, AppstoreOutlined, PartitionOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import {
  useGetIncidentAnalyticsQuery, useGetTriggeredRisksQuery,
  type IncidentCategoryStat, type IncidentSystemStat,
} from '../store/api/apiSlice';
import { RAG, BRAND, solidTagStyle } from '../theme/ragPalette';
import { premiumCard, accentDot, GOLD, TYPE, SPACE } from '../theme/premium';
import { sorterFor } from '../theme/table';
import type { WidgetDef } from './DashboardShell';

const { Text } = Typography;

const sevToken = (s: string) => {
  const v = (s || '').toUpperCase();
  if (v.includes('HIGH') || v.includes('CRIT') || v.includes('ВЫС') || v.includes('КРИТ')) return RAG.bad;
  if (v.includes('MED') || v.includes('СРЕД')) return RAG.medium;
  if (v.includes('LOW') || v.includes('НИЗ')) return RAG.good;
  return RAG.muted;
};

const RiskKpiWidget: React.FC = () => {
  const { data: a, isLoading } = useGetIncidentAnalyticsQuery();
  if (isLoading) return <div><Spin /> <Text type="secondary">Загрузка показателей…</Text></div>;
  const releaseShare = a ? Math.round((a.releaseInducedShare || 0) * 100) : 0;
  const tile = (title: string, value: React.ReactNode, icon: React.ReactNode, tone: string) => (
    <Col xs={12} md={6}>
      <Card {...premiumCard('ink')} styles={{ body: { padding: SPACE.base } }}>
        <Space align="center" size={SPACE.cozy}>
          <span style={{
            width: 38, height: 38, borderRadius: 10, background: `${tone}1A`, color: tone,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flex: '0 0 auto',
          }}>{icon}</span>
          <Statistic title={<Text type="secondary" style={TYPE.caption}>{title}</Text>} value={value as any}
            valueStyle={{ color: BRAND.ink, fontSize: TYPE.metricSm.fontSize, fontWeight: 700 }} />
        </Space>
      </Card>
    </Col>
  );
  return (
    <Row gutter={[16, 16]}>
      {tile('Всего техсбоев', a?.total ?? 0, <ThunderboltOutlined />, RAG.medium.color)}
      {tile('Открытые', a?.openCount ?? 0, <AlertOutlined />, RAG.bad.color)}
      {tile('Средн. MTTR, ч', a?.avgMttrHours != null ? a.avgMttrHours.toFixed(1) : '—', <SafetyCertificateOutlined />, RAG.good.color)}
      {tile('Доля релизных, %', releaseShare, <ThunderboltOutlined />, RAG.medium.color)}
    </Row>
  );
};

const RiskTriggersWidget: React.FC = () => {
  const navigate = useNavigate();
  const { data: triggered, isLoading } = useGetTriggeredRisksQuery();
  const top = (triggered ?? []).slice(0, 6);
  return (
    <Card
      {...premiumCard('gold')}
      title={<Space><span style={accentDot(GOLD.base)} /><span style={{ color: BRAND.ink }}>Проактивные риск-триггеры</span></Space>}
      extra={<Text type="secondary" style={TYPE.caption}>риски по текущему состоянию (техсбои / просевшие характеристики)</Text>}
    >
      {isLoading ? (
        <div><Spin /> <Text type="secondary">Загрузка триггеров…</Text></div>
      ) : top.length === 0 ? (
        <Empty description="Активных риск-триггеров нет" />
      ) : (
        <List
          dataSource={top}
          renderItem={(r) => {
            const tok = sevToken(r.severity);
            return (
              <List.Item onClick={() => navigate('/dashboard/risk-radar')} style={{ cursor: 'pointer', borderRadius: 8, padding: '8px 10px' }}>
                <Space direction="vertical" size={2} style={{ width: '100%' }}>
                  <Space wrap>
                    <Text strong>{r.title}</Text>
                    <Tag style={solidTagStyle(tok.strong)}>{r.severity}</Tag>
                    {r.characteristic && <Tag>{r.characteristic}</Tag>}
                  </Space>
                  <Text type="secondary" style={TYPE.caption}>Повод: {r.triggered_by}</Text>
                </Space>
              </List.Item>
            );
          }}
        />
      )}
    </Card>
  );
};

const IncidentsByCategoryWidget: React.FC = () => {
  const { data: a, isLoading } = useGetIncidentAnalyticsQuery();
  const cols: ColumnsType<IncidentCategoryStat> = [
    { title: 'Первопричина', dataIndex: 'category', key: 'category', sorter: sorterFor((r: IncidentCategoryStat) => r.category) },
    { title: 'Сбоев', dataIndex: 'count', key: 'count', width: 90, align: 'right', sorter: sorterFor((r: IncidentCategoryStat) => r.count) },
    { title: 'Открытых', dataIndex: 'openCount', key: 'openCount', width: 100, align: 'right', sorter: sorterFor((r: IncidentCategoryStat) => r.openCount) },
    { title: 'MTTR, ч', dataIndex: 'avgMttrHours', key: 'mttr', width: 100, align: 'right',
      sorter: sorterFor((r: IncidentCategoryStat) => r.avgMttrHours),
      render: (v: number | null) => (v != null ? v.toFixed(1) : '—') },
  ];
  return (
    <Card {...premiumCard('ink')} title={<Space><PartitionOutlined style={{ color: GOLD.base }} /><span style={{ color: BRAND.ink }}>Сбои по первопричинам</span></Space>}>
      {isLoading ? <Spin /> : (
        <Table<IncidentCategoryStat> size="small" rowKey="category" pagination={false}
          dataSource={a?.byCategory ?? []} columns={cols}
          locale={{ emptyText: <Empty description="Нет данных по сбоям" /> }} />
      )}
    </Card>
  );
};

const TopSystemsWidget: React.FC = () => {
  const { data: a, isLoading } = useGetIncidentAnalyticsQuery();
  return (
    <Card {...premiumCard('terracotta')} title={<Space><AppstoreOutlined style={{ color: GOLD.base }} /><span style={{ color: BRAND.ink }}>Нестабильные ИС (по числу сбоев)</span></Space>}>
      {isLoading ? <Spin /> : (
        <List
          dataSource={(a?.topSystems ?? []) as IncidentSystemStat[]}
          locale={{ emptyText: <Empty description="Нет данных" /> }}
          renderItem={(s) => (
            <List.Item>
              <Text strong>{s.systemName}</Text>
              <Space>
                <Tag style={solidTagStyle(RAG.medium.strong)}>сбоев: {s.count}</Tag>
                {s.openCount > 0 && <Tag style={solidTagStyle(RAG.bad.strong)}>открытых: {s.openCount}</Tag>}
              </Space>
            </List.Item>
          )}
        />
      )}
    </Card>
  );
};

export const RISK_WIDGETS: WidgetDef[] = [
  { id: 'kpi', title: 'Ключевые показатели (техсбои)', defaultEnabled: true, Component: RiskKpiWidget },
  { id: 'triggers', title: 'Проактивные риск-триггеры', defaultEnabled: true, Component: RiskTriggersWidget },
  { id: 'byCategory', title: 'Сбои по первопричинам', defaultEnabled: true, Component: IncidentsByCategoryWidget },
  { id: 'topSystems', title: 'Нестабильные ИС', defaultEnabled: false, Component: TopSystemsWidget },
];
