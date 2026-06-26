/**
 * ExecutiveDashboard.tsx — управленческий дашборд C-Level (CIO/CEO/CTO). ТЗ v9 §3.1.
 * Нативно подаёт проблематику + рекомендацию к действию; по клику — модал R1.5.
 * Спокойная RAG-палитра, минимум текста и цвета.
 */
import React, { useMemo, useState } from 'react';
import { Card, Col, Row, Typography, Tag, Progress, Badge, Space, Button } from 'antd';
import { RobotOutlined, FireOutlined, AppstoreOutlined, FundOutlined } from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import { useSelector } from 'react-redux';
import { RootState } from '../../store';
import { EXECUTIVE_MOCK, ExecSystemInsight } from '../../data/mockDashboards';
import { RAG, ragToken, levelLabel, BRAND } from '../../theme/ragPalette';
import { ActionInsightModal } from '../../components/ActionInsightModal';

const { Title, Text, Paragraph } = Typography;

const RagDot: React.FC<{ score: number; size?: number }> = ({ score, size = 14 }) => (
  <span
    title={`${score < 0 ? 'н/д' : score + '%'}`}
    style={{
      display: 'inline-block', width: size, height: size, borderRadius: '50%',
      background: ragToken(score).color, boxShadow: `0 0 0 3px ${ragToken(score).soft}`,
    }}
  />
);

const ExecutiveDashboard: React.FC = () => {
  const data = EXECUTIVE_MOCK;
  const [active, setActive] = useState<ExecSystemInsight | null>(null);
  const pendingCount = useSelector(
    (s: RootState) => s.governance.proposals.filter((p) => p.status === 'PENDING_APPROVAL').length,
  );

  const idxTok = ragToken(data.globalIndex);

  const gaugeOption = useMemo(
    () => ({
      series: [
        {
          type: 'gauge',
          startAngle: 200,
          endAngle: -20,
          min: 0,
          max: 100,
          radius: '100%',
          center: ['50%', '62%'],
          progress: { show: true, width: 16, itemStyle: { color: idxTok.color } },
          axisLine: {
            lineStyle: {
              width: 16,
              color: [
                [0.4, RAG.bad.color],
                [0.8, RAG.medium.color],
                [1, RAG.good.color],
              ],
            },
          },
          pointer: { width: 4, length: '62%', itemStyle: { color: BRAND.ink } },
          axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: { show: false },
          anchor: { show: true, size: 10, itemStyle: { color: BRAND.ink } },
          detail: {
            valueAnimation: true,
            formatter: '{value}%',
            fontSize: 30,
            fontWeight: 700,
            color: idxTok.color,
            offsetCenter: [0, '32%'],
          },
          data: [{ value: data.globalIndex }],
        },
      ],
    }),
    [data.globalIndex, idxTok.color],
  );

  return (
    <div style={{ padding: 24, background: BRAND.canvas, minHeight: '100%' }}>
      {/* Заголовок + общий индекс */}
      <Card
        styles={{ body: { padding: 20 } }}
        style={{ marginBottom: 16, borderColor: BRAND.divider }}
      >
        <Row align="middle" gutter={16}>
          <Col flex="auto">
            <Title level={4} style={{ margin: 0, color: BRAND.ink }}>
              Управленческий Dashboard · CIO / CEO / CTO
            </Title>
            <Text type="secondary">
              Общий индекс качества ИТ-ландшафта:&nbsp;
              <Text strong style={{ color: idxTok.color }}>
                {data.globalIndex}% · {levelLabel(data.globalIndex)}
              </Text>
            </Text>
          </Col>
          <Col>
            <Badge count={pendingCount} offset={[-6, 6]} color={RAG.medium.color}>
              <Button>Меры на одобрение</Button>
            </Badge>
          </Col>
          <Col>
            <div style={{ width: 200, height: 130 }}>
              <ReactECharts option={gaugeOption} style={{ height: '100%', width: '100%' }} />
            </div>
          </Col>
        </Row>
      </Card>

      {/* ТОП-3 проблемных ИС */}
      <Title level={5} style={{ color: BRAND.ink }}>
        <FireOutlined style={{ color: RAG.medium.color }} /> Топ-3 проблемных ИС — требуют внимания
      </Title>
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        {data.systems.map((sys) => {
          const tok = ragToken(sys.score);
          return (
            <Col xs={24} md={8} key={sys.id}>
              <Card
                hoverable
                onClick={() => setActive(sys)}
                style={{ borderColor: tok.border, background: tok.soft, height: '100%' }}
                styles={{ body: { padding: 16 } }}
              >
                <Space style={{ marginBottom: 8 }}>
                  <Tag icon={<RobotOutlined />} color="default" style={{ borderRadius: 12 }}>
                    AI-резюме
                  </Tag>
                  <Tag color={tok.color} style={{ color: '#fff', border: 'none' }}>
                    {sys.score}%
                  </Tag>
                </Space>
                <Title level={5} style={{ margin: '4px 0', color: BRAND.ink }}>
                  {sys.name}
                </Title>
                <Paragraph
                  type="secondary"
                  ellipsis={{ rows: 3 }}
                  style={{ fontSize: 13, marginBottom: 8 }}
                >
                  {sys.aiSummary}
                </Paragraph>
                <Text strong style={{ fontSize: 13 }}>
                  → {sys.recommendation}
                </Text>
              </Card>
            </Col>
          );
        })}
      </Row>

      <Row gutter={[16, 16]}>
        {/* Тепловая карта */}
        <Col xs={24} lg={15}>
          <Card
            title={<span style={{ color: BRAND.ink }}><AppstoreOutlined /> Тепловая карта характеристик</span>}
            style={{ borderColor: BRAND.divider }}
            styles={{ body: { overflowX: 'auto' } }}
          >
            <table style={{ borderCollapse: 'separate', borderSpacing: '0 8px', width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', fontWeight: 500, color: BRAND.inkSoft, fontSize: 12 }}>Система</th>
                  {data.heatmap.characteristics.map((c) => (
                    <th key={c} style={{ fontWeight: 500, color: BRAND.inkSoft, fontSize: 12, padding: '0 4px' }}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.heatmap.rows.map((r) => {
                  const sys = data.systems.find((s) => s.name === r.system || s.name.includes(r.system));
                  return (
                    <tr
                      key={r.system}
                      onClick={() => sys && setActive(sys)}
                      style={{ cursor: sys ? 'pointer' : 'default' }}
                    >
                      <td style={{ fontSize: 13, color: BRAND.ink, paddingRight: 12 }}>{r.system}</td>
                      {r.cells.map((cell, i) => (
                        <td key={i} style={{ textAlign: 'center' }}>
                          <RagDot score={cell.score} />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <Space size={16} style={{ marginTop: 12 }}>
              {(['good', 'medium', 'bad'] as const).map((k) => (
                <Space key={k} size={6}>
                  <RagDot score={k === 'good' ? 90 : k === 'medium' ? 60 : 20} size={10} />
                  <Text type="secondary" style={{ fontSize: 12 }}>{RAG[k].label}</Text>
                </Space>
              ))}
            </Space>
          </Card>
        </Col>

        {/* Технический долг */}
        <Col xs={24} lg={9}>
          <Card
            title={<span style={{ color: BRAND.ink }}><FundOutlined /> Статус технического долга</span>}
            style={{ borderColor: BRAND.divider, height: '100%' }}
          >
            <Text type="secondary">Risks Burndown · {data.techDebt.period}</Text>
            <div style={{ marginTop: 16 }}>
              <Progress
                percent={data.techDebt.resolvedPct}
                strokeColor={ragToken(data.techDebt.resolvedPct).color}
                trailColor={BRAND.divider}
              />
              <Text style={{ fontSize: 13 }}>
                {data.techDebt.resolvedPct}% {data.techDebt.note}
              </Text>
            </div>
          </Card>
        </Col>
      </Row>

      <ActionInsightModal open={!!active} system={active} onClose={() => setActive(null)} />
    </div>
  );
};

export default ExecutiveDashboard;
