/**
 * ManagerDashboard.tsx — дашборд Менеджера по качеству. ТЗ v9 §3.2.
 * Выбор ИС/характеристики, Gauge характеристики, таблица метрик,
 * модал профессионального суждения + постановка задачи (карточка риска).
 * Созданные меры видны топ-менеджменту со статусом «ожидает одобрения».
 *
 * Режим данных:
 *  - 'mock' (Демо) — масштабный демо-набор (30 ИС) из mockScaleData;
 *  - 'live' (LLM)  — РЕАЛЬНЫЕ оценки из БД (GET /assessments/dashboard → systemDetails):
 *    выбор реальной ИС, характеристики/метрики, «невозможно измерить» = н/д, суждения по реальным данным.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Card, Col, Row, Typography, Table, Tag, Button, Select, Space, List, Spin, Empty } from 'antd';
import { EditOutlined, CheckCircleOutlined, ClockCircleOutlined, CloseCircleOutlined, DatabaseOutlined } from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import { useSelector, shallowEqual } from 'react-redux';
import { RootState } from '../../store';
import { ManagerMetric, ManagerSystem } from '../../data/mockDashboards';
import { MANAGER_SCALE_SYSTEMS as MANAGER_MOCK_SYSTEMS } from '../../data/mockScaleData';
import { RAG, ragToken, levelLabel, BRAND } from '../../theme/ragPalette';
import { ProfessionalJudgmentModal, JudgmentTarget } from '../../components/ProfessionalJudgmentModal';
import { MeasureDecisionModal } from '../../components/MeasureDecisionModal';
import MeasureDevelopmentPanel from '../../components/MeasureDevelopmentPanel';
import FilledJudgmentsCard from '../../components/FilledJudgmentsCard';
import { ProposalStatus, selectVisibleProposals, type Proposal } from '../../store/slices/governanceSlice';

const { Title, Text } = Typography;
const VITE_API = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api/v1';

const STATUS_META: Record<ProposalStatus, { label: string; color: string; icon: React.ReactNode }> = {
  PENDING_APPROVAL: { label: 'Ожидает одобрения', color: RAG.medium.color, icon: <ClockCircleOutlined /> },
  APPROVED:         { label: 'Одобрено',          color: RAG.good.color,   icon: <CheckCircleOutlined /> },
  REJECTED:         { label: 'Отклонено',         color: RAG.bad.color,    icon: <CloseCircleOutlined /> },
};

// score -1 = «невозможно измерить» → серый/нулевой gauge, честная подпись.
const scoreLevel = (s: number) => (s < 0 ? 'Невозможно измерить' : levelLabel(s));
const scoreTok = (s: number) => (s < 0 ? { color: '#AAB0B6', soft: '#F1F2F3', border: '#D9DBDE' } : ragToken(s));

// Ответ /assessments/dashboard → список систем в форме дашборда менеджера.
interface LiveSub { name: string; score: number }
interface LiveChar { title: string; abbr: string; score: number; subs: LiveSub[] }
interface LiveSystemDetail { name: string; chars: LiveChar[] }

function mapLiveSystems(details: LiveSystemDetail[]): ManagerSystem[] {
  return details.map((s, i) => ({
    id: `live-${i}-${s.name}`,
    name: s.name,
    characteristics: s.chars.map((c) => ({
      key: c.abbr || c.title,
      title: c.title,
      score: c.score,
      metrics: c.subs.map((sub, j): ManagerMetric => ({
        id: `${i}-${c.title}-${j}`, name: sub.name, score: sub.score, formula: '',
      })),
    })),
  }));
}

const ManagerDashboard: React.FC = () => {
  const dataMode = useSelector((s: RootState) => s.ui.dataMode);
  const isLive = dataMode === 'live';

  const [liveSystems, setLiveSystems] = useState<ManagerSystem[]>([]);
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [systemId, setSystemId] = useState<string>(MANAGER_MOCK_SYSTEMS[0].id);
  const [charKey, setCharKey] = useState<string>(MANAGER_MOCK_SYSTEMS[0].characteristics[0].key);
  const [target, setTarget] = useState<JudgmentTarget | null>(null);
  const [selectedMeasure, setSelectedMeasure] = useState<Proposal | null>(null);
  const [showAllMeasures, setShowAllMeasures] = useState(false);

  // LLM-режим: тянем реальные оценки из БД.
  useEffect(() => {
    if (!isLive) { setLiveError(null); return; }
    let alive = true;
    setLiveLoading(true);
    setLiveError(null);
    const token = localStorage.getItem('token');
    fetch(`${VITE_API}/assessments/dashboard`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { systemDetails?: LiveSystemDetail[] }) => {
        if (!alive) return;
        const mapped = mapLiveSystems(d.systemDetails ?? []);
        setLiveSystems(mapped);
        if (mapped.length) { setSystemId(mapped[0].id); setCharKey(mapped[0].characteristics[0].key); }
      })
      .catch((e) => { if (alive) setLiveError(e.message); })
      .finally(() => { if (alive) setLiveLoading(false); });
    return () => { alive = false; };
  }, [isLive]);

  const activeSystems = isLive ? liveSystems : MANAGER_MOCK_SYSTEMS;
  const system = useMemo(
    () => activeSystems.find((s) => s.id === systemId) ?? activeSystems[0],
    [activeSystems, systemId],
  );

  // При смене ИС сбрасываем выбранную характеристику на первую.
  useEffect(() => {
    if (system) setCharKey(system.characteristics[0].key);
  }, [systemId, system?.id]);

  const visibleProposals = useSelector(selectVisibleProposals, shallowEqual);
  // В LLM — реальные меры выбранной ИС (демо-меры скрыты); в демо — меры выбранной демо-ИС.
  const myProposals = system
    ? visibleProposals.filter((p) => p.systemName === system.name)
    : visibleProposals;
  // Показываем 3 самых критичных (наименьший балл), остальное — по раскрытию.
  const shownProposals = useMemo(() => {
    const sorted = [...myProposals].sort((a, b) => a.calculatedScore - b.calculatedScore);
    return showAllMeasures ? sorted : sorted.slice(0, 3);
  }, [myProposals, showAllMeasures]);

  const characteristic = system?.characteristics.find((c) => c.key === charKey) ?? system?.characteristics[0];
  const charTok = scoreTok(characteristic?.score ?? -1);

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
        detail: {
          formatter: (characteristic?.score ?? -1) < 0 ? 'н/д' : '{value}%',
          fontSize: 26, fontWeight: 700, color: charTok.color, offsetCenter: [0, '34%'],
        },
        data: [{ value: Math.max(0, characteristic?.score ?? 0) }],
      }],
    }),
    [characteristic?.score, charTok.color],
  );

  const columns = [
    { title: 'Метрика', dataIndex: 'name', key: 'name', width: '46%' },
    {
      title: 'Расчётный %', dataIndex: 'score', key: 'score', width: '20%',
      render: (v: number) => <Text strong style={{ color: scoreTok(v).color }}>{v < 0 ? 'н/д' : `${v}%`}</Text>,
      sorter: (a: ManagerMetric, b: ManagerMetric) => a.score - b.score,
    },
    {
      title: 'Уровень', key: 'level', width: '20%',
      render: (_: unknown, r: ManagerMetric) => {
        const t = scoreTok(r.score);
        return <Tag color={t.color} style={{ color: '#fff', border: 'none' }}>{scoreLevel(r.score)}</Tag>;
      },
    },
    {
      title: '', key: 'action', width: '14%',
      render: (_: unknown, r: ManagerMetric) => (
        <Button
          size="small" type="primary" icon={<EditOutlined />}
          disabled={!system}
          onClick={() => system && characteristic && setTarget({
            systemName: system.name, characteristic: characteristic.title, metricName: r.name, score: Math.max(0, r.score),
          })}
        >
          Суждение
        </Button>
      ),
    },
  ];

  const showData = !!system && !!characteristic;

  return (
    <div style={{ padding: 24, background: BRAND.canvas, minHeight: '100%' }}>
      <Row align="middle" justify="space-between" gutter={[16, 8]} wrap>
        <Col>
          <Title level={4} style={{ margin: 0, color: BRAND.ink }}>Менеджер по качеству</Title>
          <Text type="secondary">
            {isLive ? 'Режим LLM · реальные данные из БД' : 'Демо-данные'}
            {showData ? ` · ИС: «${system!.name}»` : ''}
          </Text>
        </Col>
        {showData && (
          <Col>
            <Space>
              <Text type="secondary"><DatabaseOutlined /> Система:</Text>
              <Select
                value={systemId}
                onChange={setSystemId}
                style={{ minWidth: 280 }}
                showSearch
                optionFilterProp="label"
                options={activeSystems.map((s) => ({ value: s.id, label: s.name }))}
              />
            </Space>
          </Col>
        )}
      </Row>

      {isLive && liveLoading && <div style={{ marginTop: 24 }}><Spin /> <Text type="secondary">Загрузка реальных оценок…</Text></div>}
      {isLive && liveError && (
        <Alert style={{ marginTop: 16 }} type="warning" showIcon
          message="Не удалось загрузить реальные данные" description={liveError} />
      )}
      {isLive && !liveLoading && !liveError && !system && (
        <Alert style={{ marginTop: 16 }} type="info" showIcon
          message="Реальных оценок пока нет"
          description="Заполните и финализируйте оценку в разделе «Оценка ИС» — система появится здесь." />
      )}

      {showData && (
        <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
          <Col xs={24} md={10}>
            <Card style={{ borderColor: charTok.border, background: charTok.soft, height: '100%' }}>
              <Text type="secondary">Характеристика</Text>
              <Title level={5} style={{ margin: '2px 0 8px', color: BRAND.ink }}>
                {characteristic!.title}{' '}
                <Tag color={charTok.color} style={{ color: '#fff', border: 'none' }}>
                  {characteristic!.score < 0 ? 'н/д' : `${characteristic!.score}%`}
                </Tag>
              </Title>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <div style={{ flex: '0 0 122px', height: 150 }}>
                  <ReactECharts option={gaugeOption} style={{ height: '100%', width: '100%' }} />
                </div>
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {system!.characteristics.map((c) => {
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
                        <span style={{ color: scoreTok(c.score).color, fontWeight: 500, flex: '0 0 auto' }}>
                          {c.score < 0 ? 'н/д' : `${c.score}%`}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </Card>
          </Col>

          <Col xs={24} md={14}>
            <Card
              title={<span style={{ color: BRAND.ink }}>Метрики характеристики «{characteristic!.title}»</span>}
              style={{ borderColor: BRAND.divider, height: '100%' }}
              styles={{ body: { padding: 0 } }}
            >
              <Table<ManagerMetric>
                dataSource={characteristic!.metrics}
                columns={columns}
                rowKey="id"
                size="small"
                pagination={false}
                locale={{ emptyText: <Empty description="Нет метрик" /> }}
              />
            </Card>
          </Col>
        </Row>
      )}

      {/* Выработка мер по систематическим проблемам (фактура + рекомендация ИИ → топ-менеджмент) */}
      {showData && <MeasureDevelopmentPanel systemName={system!.name} system={system} />}

      {/* Меры/намерения, поставленные менеджером (видны топ-менеджменту) */}
      <Card
        title={<span style={{ color: BRAND.ink }}>Поставленные меры и намерения{showData ? ` — «${system!.name}»` : ''}</span>}
        style={{ marginTop: 16, borderColor: BRAND.divider }}
      >
        {myProposals.length === 0 ? (
          <Text type="secondary">
            Пока нет мер. Откройте «Суждение» по метрике, чтобы зафиксировать профессиональное суждение
            и поставить задачу — она уйдёт топ-менеджменту на одобрение.
          </Text>
        ) : (
          <List
            dataSource={shownProposals}
            footer={myProposals.length > 3 ? (
              <div style={{ textAlign: 'center' }}>
                <Button type="link" onClick={() => setShowAllMeasures(!showAllMeasures)}>
                  {showAllMeasures ? 'Свернуть' : `Показать все (${myProposals.length})`}
                </Button>
              </div>
            ) : undefined}
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

      {/* Заполненные профессиональные суждения по выбранной ИС — чёткая связь с выбранной
          характеристикой (та же, что в карточке «Метрики характеристики "X"») */}
      {showData && <FilledJudgmentsCard systemName={system!.name} characteristic={characteristic!.title} />}

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
