/**
 * MeasuresAiAnalyticsCard.tsx — «Топ проблемных ИС» на основе LLM-АНАЛИТИКИ ПО МЕРАМ.
 *
 * ТЗ: не карточки проф.суждений/мер, а собранная ПО ДАННЫМ МЕР аналитика от LLM —
 * где систематика по характеристикам, что приоритизировать топ-менеджменту.
 * Клиент агрегирует меры по характеристикам и запрашивает POST /reports/measures-analytics.
 */
import React, { useMemo, useState } from 'react';
import { Card, Button, Table, Tag, Typography, Alert, Spin, Space, Collapse } from 'antd';
import { RobotOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { ragToken } from '../theme/ragPalette';
import type { Proposal } from '../store/slices/governanceSlice';
import ConclusionFeedback from './ConclusionFeedback';

const { Text, Paragraph } = Typography;
const VITE_API = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api/v1';

interface AggItem { characteristic: string; count: number; systems: number; avg_score: number | null }
/** Карточка меры для конвейера рассуждения (первичные данные, BL-005). */
interface MeasureCardOut {
  system: string; characteristic: string; title: string;
  rationale?: string; expectation?: string; owner?: string; due?: string; score?: number | null;
}
interface ReasoningStage { code: string; title: string; content: string; used_llm: boolean; fell_back: boolean }
interface ReasoningTraceResp { stages: ReasoningStage[]; lenses: Array<{ title: string; view: string }>; confidence: string }
interface AnalyticsResp {
  analytics: string; llm: boolean;
  mapped_risks: Array<{ title: string; characteristic: string }>;
  reasoning?: ReasoningTraceResp | null;
  confidence?: string;
  fingerprint?: string;
  fired_rules?: string[];          // сработавшие правила движка (Rule Engine → LLM)
}

const CONFIDENCE_COLOR: Record<string, string> = { высокая: 'green', средняя: 'gold', низкая: 'red' };

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

  // Сами карточки мер — первичный источник для конвейера рассуждения (а не только агрегаты).
  const cards: MeasureCardOut[] = useMemo(() =>
    proposals
      .filter((p) => p.status === 'PENDING_APPROVAL' || p.status === 'APPROVED')
      .map((p) => ({
        system: p.systemName,
        characteristic: p.characteristic,
        title: p.riskTitle || p.metricName,
        rationale: p.rationale || undefined,
        expectation: p.expectation || undefined,
        owner: p.owner || undefined,
        due: p.dueDate || undefined,
        score: p.calculatedScore >= 0 ? p.calculatedScore : null,
      })), [proposals]);

  const run = async () => {
    setLoading(true); setErr(null);
    try {
      const token = localStorage.getItem('token');
      const r = await fetch(`${VITE_API}/reports/measures-analytics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ items: agg, cards }),
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
              message={
                <Space>
                  Заключение LLM по мерам
                  {data.confidence && (
                    <Tag color={CONFIDENCE_COLOR[data.confidence] || 'default'}>
                      уверенность: {data.confidence}
                    </Tag>
                  )}
                </Space>
              }
              description={
                <>
                  {data.fired_rules && data.fired_rules.length > 0 && (
                    <div style={{ marginBottom: 8 }}>
                      <Text strong style={{ fontSize: 12 }}>Сработавшие правила (движок решает — LLM объясняет):</Text>
                      {data.fired_rules.map((r, i) => (
                        <div key={i}><Text type="secondary" style={{ fontSize: 12 }}>• {r}</Text></div>
                      ))}
                    </div>
                  )}
                  <Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: data.mapped_risks?.length ? 8 : 0 }}>{data.analytics}</Paragraph>
                  {data.mapped_risks?.length > 0 && (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      Риски: {data.mapped_risks.map((r) => r.title).join('; ')}
                    </Text>
                  )}
                  <ConclusionFeedback fingerprint={data.fingerprint} currentText={data.analytics} />
                  {data.reasoning?.stages?.length ? (
                    <Collapse
                      ghost
                      size="small"
                      style={{ marginTop: 8 }}
                      items={[{
                        key: 'trace',
                        label: <Text type="secondary" style={{ fontSize: 12 }}>Ход рассуждения (аудируемая трасса)</Text>,
                        children: (
                          <Space direction="vertical" size={6} style={{ width: '100%' }}>
                            {data.reasoning.stages.map((s) => (
                              <div key={s.code}>
                                <Text strong style={{ fontSize: 12 }}>
                                  {s.code} · {s.title}{' '}
                                  {s.used_llm
                                    ? <Tag color="blue" style={{ fontSize: 10 }}>LLM</Tag>
                                    : <Tag style={{ fontSize: 10 }}>детерм.</Tag>}
                                </Text>
                                <Paragraph type="secondary" style={{ whiteSpace: 'pre-wrap', fontSize: 12, marginBottom: 0 }}>
                                  {s.content}
                                </Paragraph>
                              </div>
                            ))}
                          </Space>
                        ),
                      }]}
                    />
                  ) : null}
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
