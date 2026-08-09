/**
 * RiskOwnerDashboard.tsx (BL-008) — основной дашборд роли «Владелец риска» (RISK_MANAGER).
 *
 * Компактная сводка риск-контура из уже существующих данных: KPI по техсбоям (объём, открытые,
 * MTTR, доля релизных), проактивные риск-триггеры и быстрые переходы в реестр рисков и риск-экономику.
 * Состав будет расширен через персональную настройку виджетов (Фаза 4).
 */
import React from 'react';
import { Card, Col, Row, Typography, Tag, List, Statistic, Empty, Spin, Button, Space } from 'antd';
import {
  SafetyCertificateOutlined, ThunderboltOutlined, AlertOutlined, AuditOutlined, WarningOutlined, RightOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useGetIncidentAnalyticsQuery, useGetTriggeredRisksQuery } from '../../store/api/apiSlice';
import { RAG, BRAND, solidTagStyle } from '../../theme/ragPalette';
import { premiumCard, accentDot, pageContainer, pageTitle, GOLD, TYPE, SPACE } from '../../theme/premium';

const { Title, Text } = Typography;

// Уровень серьёзности (any casing / ru) → RAG-тон плашки.
const sevToken = (s: string) => {
  const v = (s || '').toUpperCase();
  if (v.includes('HIGH') || v.includes('CRIT') || v.includes('ВЫС') || v.includes('КРИТ')) return RAG.bad;
  if (v.includes('MED') || v.includes('СРЕД')) return RAG.medium;
  if (v.includes('LOW') || v.includes('НИЗ')) return RAG.good;
  return RAG.muted;
};

const RiskOwnerDashboard: React.FC = () => {
  const navigate = useNavigate();
  const { data: analytics, isLoading: aLoading } = useGetIncidentAnalyticsQuery();
  const { data: triggered, isLoading: tLoading } = useGetTriggeredRisksQuery();

  const mttr = analytics?.avgMttrHours;
  const releaseShare = analytics ? Math.round((analytics.releaseInducedShare || 0) * 100) : 0;
  const topRisks = (triggered ?? []).slice(0, 6);

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
    <div style={pageContainer}>
      <Row align="middle" justify="space-between" gutter={[16, 8]} wrap>
        <Col>
          <Title level={4} style={pageTitle}>
            <SafetyCertificateOutlined style={{ color: GOLD.base, marginRight: 8 }} />Основное — владелец риска
          </Title>
          <Text type="secondary">Сводка риск-контура: техсбои, проактивные триггеры, реестр и экономика риска.</Text>
        </Col>
        <Col>
          <Space wrap>
            <Button icon={<WarningOutlined />} onClick={() => navigate('/risks')}>Реестр рисков</Button>
            <Button type="primary" icon={<AuditOutlined />} onClick={() => navigate('/risk-economics')}>Риск-экономика</Button>
          </Space>
        </Col>
      </Row>

      {aLoading ? (
        <div style={{ marginTop: 24 }}><Spin /> <Text type="secondary">Загрузка показателей…</Text></div>
      ) : (
        <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
          {tile('Всего техсбоев', analytics?.total ?? 0, <ThunderboltOutlined />, RAG.medium.color)}
          {tile('Открытые', analytics?.openCount ?? 0, <AlertOutlined />, RAG.bad.color)}
          {tile('Средн. MTTR, ч', mttr != null ? mttr.toFixed(1) : '—', <SafetyCertificateOutlined />, RAG.good.color)}
          {tile('Доля релизных, %', releaseShare, <ThunderboltOutlined />, RAG.medium.color)}
        </Row>
      )}

      <Card
        {...premiumCard('gold', { marginTop: 16 })}
        title={<Space><span style={accentDot(GOLD.base)} /><span style={{ color: BRAND.ink }}>Проактивные риск-триггеры</span></Space>}
        extra={<Text type="secondary" style={TYPE.caption}>риски по текущему состоянию (техсбои / просевшие характеристики)</Text>}
      >
        {tLoading ? (
          <div><Spin /> <Text type="secondary">Загрузка триггеров…</Text></div>
        ) : topRisks.length === 0 ? (
          <Empty description="Активных риск-триггеров нет" />
        ) : (
          <List
            dataSource={topRisks}
            renderItem={(r) => {
              const tok = sevToken(r.severity);
              return (
                <List.Item
                  onClick={() => navigate('/dashboard/risk-radar')}
                  style={{ cursor: 'pointer', borderRadius: 8, padding: '8px 10px' }}
                  actions={[<RightOutlined key="go" style={{ color: BRAND.inkSoft }} />]}
                >
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
    </div>
  );
};

export default RiskOwnerDashboard;
