/**
 * MeasuresAiAnalyticsCard.tsx — «Топ проблемных ИС» на основе LLM-АНАЛИТИКИ ПО МЕРАМ.
 *
 * ТЗ: не карточки проф.суждений/мер, а собранная ПО ДАННЫМ МЕР аналитика от LLM —
 * где систематика по характеристикам, что приоритизировать топ-менеджменту.
 * Клиент агрегирует меры по характеристикам и запрашивает POST /reports/measures-analytics.
 */
import React, { useMemo, useState } from 'react';
import { Card, Button, Table, Tag, Typography, Alert, Spin, Space } from 'antd';
import { RobotOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { ragToken } from '../theme/ragPalette';
import type { Proposal } from '../store/slices/governanceSlice';

const { Text, Paragraph } = Typography;
const VITE_API = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api/v1';

interface AggItem { characteristic: string; count: number; systems: number; avg_score: number | null }
interface AnalyticsResp { analytics: string; llm: boolean; mapped_risks: Array<{ title: string; characteristic: string }> }

const MeasuresAiAnalyticsCard: React.FC<{ proposals: Proposal[] }> = ({ proposals }) => {
  const [data, setData] = useState<AnalyticsResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const agg: AggItem[] = useMemo(() => {
    const m = new Map<string, { count: number; systems: Set<string>; scores: number[] }>();
    proposals
      .filter((p) => p.status === 'PENDING_APPROVAL' || p.status === 'APPROVED')
      .forEach((p) => {
        const e = m.get(p.characteristic) ?? { count: 0, systems: new Set<string>(), scores: [] };
        e.count += 1;
        e.systems.add(p.systemName);
        if (p.calculatedScore >= 0) e.scores.push(p.calculatedScore);
        m.set(p.characteristic, e);
      });
    return [...m.entries()]
      .map(([characteristic, e]) => ({
        characteristic, count: e.count, systems: e.systems.size,
        avg_score: e.scores.length ? Math.round(e.scores.reduce((a, b) => a + b, 0) / e.scores.length) : null,
      }))
      .sort((a, b) => b.count - a.count);
  }, [proposals]);

  const run = async () => {
    setLoading(true); setErr(null);
    try {
      const token = localStorage.getItem('token');
      const r = await fetch(`${VITE_API}/reports/measures-analytics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(agg),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData(await r.json());
    } catch (e: any) { setErr(e.message); } finally { setLoading(false); }
  };

  return (
    <Card
      title={<span><RobotOutlined /> Топ проблемных ИС — AI-аналитика по мерам</span>}
      style={{ marginBottom: 16 }}
      styles={{ body: { paddingTop: 12 } }}
      extra={<Button type="primary" icon={<ThunderboltOutlined />} loading={loading} disabled={agg.length === 0} onClick={run}>
        Собрать AI-аналитику
      </Button>}
    >
      {agg.length === 0 ? (
        <Text type="secondary">Активных мер нет — аналитика по мерам не формируется.</Text>
      ) : (
        <Space direction="vertical" style={{ width: '100%' }} size={10}>
          <Table<AggItem>
            dataSource={agg}
            rowKey="characteristic"
            size="small"
            pagination={false}
            columns={[
              { title: 'Характеристика (систематика)', dataIndex: 'characteristic' },
              { title: 'Мер', dataIndex: 'count', width: 80, render: (v: number) => <Tag color="volcano">{v}</Tag> },
              { title: 'ИС охвачено', dataIndex: 'systems', width: 110 },
              { title: 'Ср. балл', dataIndex: 'avg_score', width: 100,
                render: (v: number | null) => v == null ? '—' : <Tag color={ragToken(v).color} style={{ color: '#fff', border: 'none' }}>{v}%</Tag> },
            ]}
          />
          {loading && <div><Spin size="small" /> <Text type="secondary">LLM собирает аналитику по мерам (~1 мин)…</Text></div>}
          {err && <Alert type="warning" showIcon message="LLM недоступна" description={err} />}
          {data && !loading && (
            <Alert
              type="info"
              showIcon
              icon={<RobotOutlined />}
              message="Предложения LLM по мерам"
              description={
                <>
                  <Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: data.mapped_risks?.length ? 8 : 0 }}>{data.analytics}</Paragraph>
                  {data.mapped_risks?.length > 0 && (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      Риски: {data.mapped_risks.map((r) => r.title).join('; ')}
                    </Text>
                  )}
                </>
              }
            />
          )}
        </Space>
      )}
    </Card>
  );
};

export default MeasuresAiAnalyticsCard;
