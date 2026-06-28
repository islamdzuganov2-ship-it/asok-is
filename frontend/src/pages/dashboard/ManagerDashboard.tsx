/**
 * ManagerDashboard.tsx — дашборд Менеджера по качеству. ТЗ v9 §3.2.
 * Выбор ИС/характеристики, Gauge характеристики, таблица метрик,
 * модал профессионального суждения + постановка задачи (карточка риска).
 * Созданные меры видны топ-менеджменту со статусом «ожидает одобрения».
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Card, Col, Row, Typography, Table, Tag, Button, Select, Space, List } from 'antd';
import { EditOutlined, CheckCircleOutlined, ClockCircleOutlined, CloseCircleOutlined, DatabaseOutlined } from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import { useSelector, shallowEqual } from 'react-redux';
import { RootState } from '../../store';
import { ManagerMetric } from '../../data/mockDashboards';
import { MANAGER_SCALE_SYSTEMS as MANAGER_MOCK_SYSTEMS } from '../../data/mockScaleData';
import { RAG, ragToken, levelLabel, BRAND } from '../../theme/ragPalette';
import { ProfessionalJudgmentModal, JudgmentTarget } from '../../components/ProfessionalJudgmentModal';
import { MeasureDecisionModal } from '../../components/MeasureDecisionModal';
import { ProposalStatus, selectVisibleProposals, type Proposal } from '../../store/slices/governanceSlice';

const { Title, Text } = Typography;

const STATUS_META: Record<ProposalStatus, { label: string; color: string; icon: React.ReactNode }> = {
  PENDING_APPROVAL: { label: 'Ожидает одобрения', color: RAG.medium.color, icon: <ClockCircleOutlined /> },
  APPROVED:         { label: 'Одобрено',          color: RAG.good.color,   icon: <CheckCircleOutlined /> },
  REJECTED:         { label: 'Отклонено',         color: RAG.bad.color,    icon: <CloseCircleOutlined /> },
};

const ManagerDashboard: React.FC = () => {
  const [systemId, setSystemId] = useState(MANAGER_MOCK_SYSTEMS[0].id);
  const system = useMemo(
    () => MANAGER_MOCK_SYSTEMS.find((s) => s.id === systemId) ?? MANAGER_MOCK_SYSTEMS[0],
    [systemId],
  );
  const [charKey, setCharKey] = useState(system.characteristics[0].key);
  const [target, setTarget] = useState<JudgmentTarget | null>(null);
  const [selectedMeasure, setSelectedMeasure] = useState<Proposal | null>(null);
  const dataMode = useSelector((s: RootState) => s.ui.dataMode);
  const isLive = dataMode === 'live';

  // При смене ИС перестраиваем борд: сбрасываем выбранную характеристику на первую.
  useEffect(() => { setCharKey(system.characteristics[0].key); }, [systemId]);

  const characteristic = system.characteristics.find((c) => c.key === charKey) ?? system.characteristics[0];
  const charTok = ragToken(characteristic.score);

  const visibleProposals = useSelector(selectVisibleProposals, shallowEqual);
  // В демо — меры выбранной (демо) ИС; в LLM — все реальные меры (демо-системы скрыты).
  const myProposals = isLive ? visibleProposals : visibleProposals.filter((p) => p.systemName === system.name);

  const gaugeOption = useMemo(
    () => ({
      series: [{
        type: 'gauge',
        startAngle: 200, endAngle: -20, min: 0, max: 100, radius: '100%', center: ['50%', '60%'],
        progress: { show: true, width: 14, itemStyle: { color: charTok.color } },
        axisLine: { lineStyle: { width: 14, color: [[0.4, RAG.bad.color], [0.8, RAG.medium.color], [1, RAG.good.color]] } },
        pointer: { width: 4, length: '60%', itemStyle: { color: BRAND.ink } },
        axisTick: { show: false }, splitLine: { show: false }, axisLabel: { show: false },
        anchor: { show: true, size: 8, itemStyle: { color: BRAND.ink } },
        detail: { formatter: '{value}%', fontSize: 26, fontWeight: 700, color: charTok.color, offsetCenter: [0, '34%'] },
        data: [{ value: characteristic.score }],
      }],
    }),
    [characteristic.score, charTok.color],
  );

  const columns = [
    { title: 'Метрика', dataIndex: 'name', key: 'name', width: '46%' },
    {
      title: 'Расчётный %', dataIndex: 'score', key: 'score', width: '20%',
      render: (v: number) => <Text strong style={{ color: ragToken(v).color }}>{v}%</Text>,
      sorter: (a: ManagerMetric, b: ManagerMetric) => a.score - b.score,
    },
    {
      title: 'Уровень', key: 'level', width: '20%',
      render: (_: unknown, r: ManagerMetric) => {
        const t = ragToken(r.score);
        return <Tag color={t.color} style={{ color: '#fff', border: 'none' }}>{levelLabel(r.score)}</Tag>;
      },
    },
    {
      title: '', key: 'action', width: '14%',
      render: (_: unknown, r: ManagerMetric) => (
        <Button
          size="small" type="primary" icon={<EditOutlined />}
          onClick={() => setTarget({
            systemName: system.name, characteristic: characteristic.title, metricName: r.name, score: r.score,
          })}
        >
          Суждение
        </Button>
      ),
    },
  ];

  return (
    <div style={{ padding: 24, background: BRAND.canvas, minHeight: '100%' }}>
      <Row align="middle" justify="space-between" gutter={[16, 8]} wrap>
        <Col>
          <Title level={4} style={{ margin: 0, color: BRAND.ink }}>Менеджер по качеству</Title>
          <Text type="secondary">{isLive ? 'Режим LLM · реальные данные' : `Оценка ИС: «${system.name}»`}</Text>
        </Col>
        {!isLive && (
          <Col>
            <Space>
              <Text type="secondary"><DatabaseOutlined /> Система:</Text>
              <Select
                value={systemId}
                onChange={setSystemId}
                style={{ minWidth: 280 }}
                showSearch
                optionFilterProp="label"
                options={MANAGER_MOCK_SYSTEMS.map((s) => ({ value: s.id, label: s.name }))}
              />
            </Space>
          </Col>
        )}
      </Row>

      {isLive ? (
        <Alert
          style={{ marginTop: 16 }}
          type="info"
          showIcon
          message="Режим LLM: демо-системы скрыты"
          description="Показаны только реальные данные. Для разбора метрик и постановки профессиональных суждений заполните оценки в разделе «Оценка ИС». Реальные меры — ниже."
        />
      ) : (
        <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
          <Col xs={24} md={10}>
            <Card style={{ borderColor: charTok.border, background: charTok.soft, height: '100%' }}>
              <Text type="secondary">Характеристика</Text>
              <Title level={5} style={{ margin: '2px 0 8px', color: BRAND.ink }}>
                {characteristic.title}{' '}
                <Tag color={charTok.color} style={{ color: '#fff', border: 'none' }}>{characteristic.score}%</Tag>
              </Title>
              {/* Визуал (gauge) — слева, перечисление характеристик — сбоку справа */}
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <div style={{ flex: '0 0 122px', height: 150 }}>
                  <ReactECharts option={gaugeOption} style={{ height: '100%', width: '100%' }} />
                </div>
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {system.characteristics.map((c) => {
                    const activeC = c.key === charKey;
                    return (
                      <div
                        key={c.key}
                        onClick={() => setCharKey(c.key)}
                        title={c.title}
                        style={{
                          cursor: 'pointer', fontSize: 12, padding: '5px 8px', borderRadius: 6,
                          background: activeC ? '#fff' : 'transparent',
                          border: `1px solid ${activeC ? charTok.border : 'transparent'}`,
                          display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center',
                        }}
                      >
                        <span style={{
                          color: BRAND.ink, overflow: 'hidden', textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap', fontWeight: activeC ? 500 : 400,
                        }}>{c.title}</span>
                        <span style={{ color: ragToken(c.score).color, fontWeight: 500, flex: '0 0 auto' }}>{c.score}%</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </Card>
          </Col>

          <Col xs={24} md={14}>
            <Card
              title={<span style={{ color: BRAND.ink }}>Метрики характеристики «{characteristic.title}»</span>}
              style={{ borderColor: BRAND.divider, height: '100%' }}
              styles={{ body: { padding: 0 } }}
            >
              <Table<ManagerMetric>
                dataSource={characteristic.metrics}
                columns={columns}
                rowKey="id"
                size="small"
                pagination={false}
              />
            </Card>
          </Col>
        </Row>
      )}

      {/* Меры/намерения, поставленные менеджером (видны топ-менеджменту) */}
      <Card
        title={<span style={{ color: BRAND.ink }}>Поставленные меры и намерения</span>}
        style={{ marginTop: 16, borderColor: BRAND.divider }}
      >
        {myProposals.length === 0 ? (
          <Text type="secondary">
            Пока нет мер. Откройте «Суждение» по метрике, чтобы зафиксировать профессиональное суждение
            и поставить задачу — она уйдёт топ-менеджменту на одобрение.
          </Text>
        ) : (
          <List
            dataSource={myProposals}
            renderItem={(p) => {
              const meta = STATUS_META[p.status];
              return (
                <List.Item
                  onClick={() => setSelectedMeasure(p)}
                  style={{ cursor: 'pointer', borderRadius: 8, padding: '8px 10px' }}
                >
                  <Space direction="vertical" size={2} style={{ width: '100%' }}>
                    <Space wrap>
                      <Text strong>{p.riskTitle || p.metricName}</Text>
                      <Tag icon={meta.icon} color={meta.color} style={{ color: '#fff', border: 'none' }}>
                        {meta.label}
                      </Tag>
                      {p.execution === 'DONE' && <Tag color="green">выполнено</Tag>}
                      {p.execution === 'NOT_DONE' && <Tag color="red">не выполнено</Tag>}
                      {p.status === 'APPROVED' && !p.execution && <Tag color="blue">отчитаться о выполнении</Tag>}
                      <Text type="secondary" style={{ fontSize: 12 }}>{p.characteristic}</Text>
                    </Space>
                    <Text type="secondary" style={{ fontSize: 13 }}>{p.rationale}</Text>
                    {(p.owner || p.dueDate) && (
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {p.owner && <>Ответственный: {p.owner}{p.ownerRole ? ` (${p.ownerRole})` : ''}. </>}
                        {p.dueDate && <>Срок: {p.dueDate}.</>}
                      </Text>
                    )}
                    {p.decidedBy && (
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        Решение: {meta.label.toLowerCase()} ({p.decidedBy})
                      </Text>
                    )}
                  </Space>
                </List.Item>
              );
            }}
          />
        )}
      </Card>

      <ProfessionalJudgmentModal open={!!target} target={target} onClose={() => setTarget(null)} />
      <MeasureDecisionModal
        open={!!selectedMeasure}
        proposal={selectedMeasure}
        onClose={() => setSelectedMeasure(null)}
      />
    </div>
  );
};

export default ManagerDashboard;
