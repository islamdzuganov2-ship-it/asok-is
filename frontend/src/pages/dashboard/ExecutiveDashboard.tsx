/**
 * ExecutiveDashboard.tsx — управленческий дашборд C-Level (CIO/CEO/CTO). ТЗ v9 §3.1.
 * Нативно подаёт проблематику + рекомендацию к действию; по клику — модал R1.5.
 * Спокойная RAG-палитра, минимум текста и цвета.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Card, Col, Row, Typography, Tag, Progress, Badge, Space, Button, Spin, Alert, Modal, Table } from 'antd';
import { RobotOutlined, FireOutlined, AppstoreOutlined, FundOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import ReactECharts from 'echarts-for-react';
import { useSelector, shallowEqual } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { RootState } from '../../store';
import { ExecSystemInsight, ExecutiveDashboardData } from '../../data/mockDashboards';
import { EXECUTIVE_SCALE, HEATMAP_CHARS_FULL } from '../../data/mockScaleData';
import { RAG, ragToken, levelLabel, BRAND, critTagStyle } from '../../theme/ragPalette';
import { ActionInsightModal } from '../../components/ActionInsightModal';
import { MeasureDecisionModal } from '../../components/MeasureDecisionModal';
import { MeasuresRegistryCard } from '../../components/MeasuresRegistryCard';
import { TechDebtCard } from '../../components/TechDebtCard';
import { selectVisibleProposals, type Proposal } from '../../store/slices/governanceSlice';

// Точное сопоставление меры с ячейкой теплокарты (по полному названию характеристики).
const norm = (s: string) => (s || '').toLowerCase().replace(/ё/g, 'е').replace(/[.\s]/g, '');

// Ранг критичности: чем меньше — тем критичнее (для отбора топ-3 систем).
const CRIT_RANK: Record<string, number> = {
  'MISSION CRITICAL': 0, 'BUSINESS CRITICAL': 1, 'BUSINESS OPERATIONAL': 2,
};

const { Title, Text, Paragraph } = Typography;
const VITE_API = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api/v1';

interface LiveDashboard {
  globalHealthScore: number;
  aiInsights: string;
  heatmapData?: [number, number, number][];
  xAxisLabels?: string[];
  yAxisLabels?: string[];
  problematicSystems?: { id: string; name: string; criticality: string; lowMetricsCount: number }[];
}

// Бакет уровня (0..5) → представительный % для RAG-индикации.
const BUCKET_SCORE = [-1, 10, 30, 50, 70, 90];

// Сборка структуры управленческого дашборда из реального ответа API (LLM-режим).
function buildExecFromLive(live: LiveDashboard | null): ExecutiveDashboardData {
  const empty: ExecutiveDashboardData = {
    globalIndex: live ? Math.round(live.globalHealthScore) : 0,
    systems: [], heatmap: { characteristics: [], rows: [] },
    techDebt: { resolvedPct: 0, period: '', note: '' },
  };
  if (!live || !live.yAxisLabels?.length || !live.xAxisLabels?.length) return empty;

  const chars = live.xAxisLabels;
  const sysNames = live.yAxisLabels;
  const matrix: number[][] = sysNames.map(() => chars.map(() => 0));
  (live.heatmapData ?? []).forEach(([x, y, b]) => { if (matrix[y] && x < chars.length) matrix[y][x] = b; });
  const critMap = new Map((live.problematicSystems ?? []).map((s) => [s.name, s.criticality]));

  const rows = sysNames.map((sys, y) => ({
    system: sys,
    cells: chars.map((_, x) => ({ score: BUCKET_SCORE[matrix[y][x]] ?? -1 })),
  }));

  const systems: ExecSystemInsight[] = sysNames.map((sys, y) => {
    const scores = chars.map((_, x) => BUCKET_SCORE[matrix[y][x]] ?? -1).filter((s) => s >= 0);
    const score = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
    let weakIdx = 0, weakScore = 101;
    chars.forEach((_, x) => {
      const s = BUCKET_SCORE[matrix[y][x]] ?? -1;
      if (s >= 0 && s < weakScore) { weakScore = s; weakIdx = x; }
    });
    const weakChar = chars[weakIdx] ?? '';
    return {
      id: `live-${y}`, name: sys, score,
      criticality: (critMap.get(sys) as ExecSystemInsight['criticality']) ?? 'BUSINESS OPERATIONAL',
      weakCharacteristic: weakChar,
      aiSummary: `Интегральная оценка качества — ${score}%. Наиболее просевшая характеристика — ${weakChar} (${weakScore <= 100 ? weakScore : '—'}%).`,
      recommendation: 'Сформировать меры по просевшим характеристикам.',
      owner: 'Руководитель ИТ-блока (Иванов И.И.)',
      escalateTo: 'CTO',
      actions: ['Назначить ответственного и срок', 'Зафиксировать меру в плане качества', 'Включить контроль выполнения'],
    };
  });

  return {
    globalIndex: Math.round(live.globalHealthScore),
    systems,
    heatmap: { characteristics: chars, rows },
    techDebt: { resolvedPct: 0, period: '', note: '' },
  };
}

const RagDot: React.FC<{ score: number; size?: number; label?: string }> = ({ score, size = 14, label }) => (
  <span
    title={`${label ? label + ': ' : ''}${score < 0 ? 'н/д' : score + '%'}`}
    style={{
      display: 'inline-block', width: size, height: size, borderRadius: '50%',
      background: ragToken(score).color, boxShadow: `0 0 0 3px ${ragToken(score).soft}`,
    }}
  />
);

const ExecutiveDashboard: React.FC = () => {
  const navigate = useNavigate();
  const dataMode = useSelector((s: RootState) => s.ui.dataMode);
  const isLive = dataMode === 'live';
  const [active, setActive] = useState<ExecSystemInsight | null>(null);
  const proposals = useSelector(selectVisibleProposals, shallowEqual);
  const pendingProposals = proposals.filter((p) => p.status === 'PENDING_APPROVAL');
  const pendingCount = pendingProposals.length;
  const [decisionProposal, setDecisionProposal] = useState<Proposal | null>(null);
  const [allOpen, setAllOpen] = useState(false);
  const [pendingOpen, setPendingOpen] = useState(false);
  const [showAllHeatmap, setShowAllHeatmap] = useState(false);
  // Фокус на характеристике для карточки ИС (клик по ячейке теплокарты).
  const [activeChar, setActiveChar] = useState<string | undefined>(undefined);

  // Источник данных: 'mock' (демо) ↔ 'live' (реальное API + LLM, без моков).
  const [live, setLive] = useState<LiveDashboard | null>(null);
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLive) { setLive(null); setLiveError(null); return; }
    let alive = true;
    setLiveLoading(true);
    setLiveError(null);
    const token = localStorage.getItem('token');
    fetch(`${VITE_API}/reports/executive-dashboard`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: LiveDashboard) => { if (alive) setLive(d); })
      .catch((e) => { if (alive) setLiveError(e.message); })
      .finally(() => { if (alive) setLiveLoading(false); });
    return () => { alive = false; };
  }, [isLive]);

  // Демо → моки; LLM → построено из реального API (или пусто, без подмешивания моков).
  const data: ExecutiveDashboardData = useMemo(
    () => (isLive ? buildExecFromLive(live) : EXECUTIVE_SCALE),
    [isLive, live],
  );
  // Полные названия характеристик для сопоставления мер с ячейками (по режиму).
  const heatCharsFull = isLive ? data.heatmap.characteristics : HEATMAP_CHARS_FULL;

  // Зелёная точка — только если есть мера, ПО КОТОРОЙ НЕ ПРИНЯТО РЕШЕНИЕ (ожидает решения).
  const cellHasMeasure = (sys: string, fullChar: string) =>
    proposals.some((p) =>
      p.status === 'PENDING_APPROVAL'
      && norm(p.systemName) === norm(sys)
      && norm(p.characteristic) === norm(fullChar));

  // Топ-3 проблемных ИС по критичности (самые высокие), затем по баллу.
  const topCards = [...data.systems]
    .sort((a, b) => (CRIT_RANK[a.criticality] - CRIT_RANK[b.criticality]) || (a.score - b.score))
    .slice(0, 3);

  // Строки теплокарты: по критичности → по баллу (худшие). По умолчанию топ-5, остальное под кнопкой.
  const orderedHeatRows = [...data.heatmap.rows].sort((a, b) => {
    const sa = data.systems.find((s) => s.name === a.system);
    const sb = data.systems.find((s) => s.name === b.system);
    const ca = sa ? CRIT_RANK[sa.criticality] : 9;
    const cb = sb ? CRIT_RANK[sb.criticality] : 9;
    return (ca - cb) || ((sa?.score ?? 100) - (sb?.score ?? 100));
  });
  const shownHeatRows = showAllHeatmap ? orderedHeatRows : orderedHeatRows.slice(0, 5);

  const globalIndex = data.globalIndex;
  const idxTok = ragToken(globalIndex);

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
          data: [{ value: globalIndex }],
        },
      ],
    }),
    [globalIndex, idxTok.color],
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
              Управленческий Dashboard
            </Title>
            <Text type="secondary">
              Общий индекс качества ИТ-ландшафта:&nbsp;
              <Text strong style={{ color: idxTok.color }}>
                {globalIndex}% · {levelLabel(globalIndex)}
              </Text>
              &nbsp;
              <Tag color={isLive ? 'green' : 'default'} style={{ marginLeft: 8 }}>
                {isLive ? 'LLM · live' : 'Демо'}
              </Tag>
            </Text>
          </Col>
          <Col>
            <Badge count={pendingCount} offset={[-6, 6]} color={RAG.medium.color}>
              <Button onClick={() => setPendingOpen(true)}>Меры на одобрение</Button>
            </Badge>
          </Col>
          <Col>
            <div style={{ width: 200, height: 130 }}>
              <ReactECharts option={gaugeOption} style={{ height: '100%', width: '100%' }} />
            </div>
          </Col>
        </Row>
      </Card>

      {/* Live AI-резюме от встроенной LLM (только в режиме LLM) */}
      {isLive && (
        <Card
          style={{ marginBottom: 16, borderColor: BRAND.divider }}
          styles={{ body: { padding: 16 } }}
        >
          <Space align="start">
            <RobotOutlined style={{ color: BRAND.ink, fontSize: 18, marginTop: 2 }} />
            <div>
              <Text strong style={{ color: BRAND.ink }}>AI-резюме (встроенная LLM, без галлюцинаций)</Text>
              {liveLoading && <div style={{ marginTop: 8 }}><Spin size="small" /> <Text type="secondary">Генерация на локальной модели…</Text></div>}
              {liveError && (
                <Alert
                  style={{ marginTop: 8 }}
                  type="warning"
                  showIcon
                  message="Не удалось получить ответ LLM — переключитесь на «Демо» или проверьте backend."
                  description={liveError}
                />
              )}
              {!liveLoading && !liveError && live && (
                <Paragraph style={{ marginTop: 8, marginBottom: 0, fontSize: 13 }}>{live.aiInsights}</Paragraph>
              )}
            </div>
          </Space>
        </Card>
      )}

      {/* ТОП-3 проблемных ИС */}
      <Row align="middle" justify="space-between" style={{ marginBottom: 4 }}>
        <Col>
          <Title level={5} style={{ color: BRAND.ink, margin: 0 }}>
            <FireOutlined style={{ color: RAG.medium.color }} /> Топ проблемных ИС — требуют внимания
            <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>(по критичности · всего систем: {data.systems.length})</Text>
          </Title>
        </Col>
        <Col>
          <Button type="link" onClick={() => setAllOpen(true)}>Показать все системы →</Button>
        </Col>
      </Row>
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        {topCards.map((sys) => {
          const tok = ragToken(sys.score);
          return (
            <Col xs={24} md={8} key={sys.id}>
              <Card
                hoverable
                onClick={() => setActive(sys)}
                style={{ borderColor: tok.border, background: tok.soft, height: '100%' }}
                styles={{ body: { padding: 16 } }}
              >
                <Space style={{ marginBottom: 8 }} wrap>
                  <Tag icon={<RobotOutlined />} color="default" style={{ borderRadius: 12 }}>
                    AI-резюме
                  </Tag>
                  <Tag color={tok.color} style={{ color: '#fff', border: 'none' }}>
                    {sys.score}%
                  </Tag>
                  <Tag style={critTagStyle(sys.criticality)}>
                    {sys.criticality}
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
            extra={<Button type="link" size="small" onClick={() => navigate('/dashboard/analytics')}>Детали →</Button>}
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
                {shownHeatRows.map((r) => {
                  const sys = data.systems.find((s) => s.name === r.system || s.name.includes(r.system));
                  return (
                    <tr key={r.system}>
                      <td
                        onClick={() => { if (sys) { setActiveChar(undefined); setActive(sys); } }}
                        title="Открыть карточку ИС (кто отвечает, действия, все меры)"
                        style={{ fontSize: 13, color: BRAND.ink, paddingRight: 12, cursor: sys ? 'pointer' : 'default' }}
                      >{r.system}</td>
                      {r.cells.map((cell, i) => {
                        const measured = cellHasMeasure(r.system, heatCharsFull[i]);
                        return (
                          <td
                            key={i}
                            onClick={() => { if (sys) { setActiveChar(heatCharsFull[i]); setActive(sys); } }}
                            title={`${heatCharsFull[i]} — карточка ИС с мерами по характеристике`}
                            style={{ textAlign: 'center', cursor: sys ? 'pointer' : 'default' }}
                          >
                            <span style={{ position: 'relative', display: 'inline-block', lineHeight: 0 }}>
                              <RagDot score={cell.score} label={`${r.system} · ${heatCharsFull[i]}${measured ? ' · мера ожидает решения' : ''}`} />
                              {measured && (
                                <span
                                  title="По этой характеристике есть мера, ожидающая решения"
                                  style={{
                                    position: 'absolute', top: -5, right: -5, width: 8, height: 8,
                                    borderRadius: '50%', background: RAG.good.color,
                                    boxShadow: '0 0 0 2px #fff',
                                  }}
                                />
                              )}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <Space size={16} style={{ marginTop: 12 }} wrap>
              {(['good', 'medium', 'bad'] as const).map((k) => (
                <Space key={k} size={6}>
                  <RagDot score={k === 'good' ? 90 : k === 'medium' ? 60 : 20} size={10} />
                  <Text type="secondary" style={{ fontSize: 12 }}>{RAG[k].label}</Text>
                </Space>
              ))}
              <Space size={6}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: RAG.good.color, boxShadow: '0 0 0 2px #fff', display: 'inline-block' }} />
                <Text type="secondary" style={{ fontSize: 12 }}>мера ожидает решения</Text>
              </Space>
            </Space>
            {orderedHeatRows.length > 5 && (
              <div style={{ textAlign: 'center', marginTop: 8 }}>
                <Button type="link" onClick={() => setShowAllHeatmap(!showAllHeatmap)}>
                  {showAllHeatmap ? 'Свернуть' : `Раскрыть все (${orderedHeatRows.length})`}
                </Button>
              </div>
            )}
          </Card>
        </Col>

        {/* Технический долг — несколько burndown/счётчиков (кликабельны) + выбор периода */}
        <Col xs={24} lg={9}>
          <TechDebtCard proposals={proposals} onOpenMeasure={setDecisionProposal} />
        </Col>
      </Row>

      {/* Реестр мер качества — фильтры, приоритетная сортировка, сроки, решение по клику */}
      <MeasuresRegistryCard proposals={proposals} onOpen={setDecisionProposal} />

      <ActionInsightModal
        open={!!active}
        system={active}
        characteristic={activeChar}
        onClose={() => { setActive(null); setActiveChar(undefined); }}
      />
      <MeasureDecisionModal
        open={!!decisionProposal}
        proposal={decisionProposal}
        onClose={() => setDecisionProposal(null)}
      />

      {/* Меры на одобрение — быстрый разбор для CIO: клик по мере открывает решение */}
      <Modal
        open={pendingOpen}
        onCancel={() => setPendingOpen(false)}
        footer={null}
        width={620}
        title={`Меры, ожидающие вашего решения (${pendingCount})`}
      >
        {pendingProposals.length === 0 ? (
          <Text type="secondary">Нет мер на одобрение.</Text>
        ) : (
          <Table<Proposal>
            dataSource={[...pendingProposals].sort((a, b) => a.calculatedScore - b.calculatedScore)}
            rowKey="id"
            size="small"
            pagination={{ pageSize: 8, hideOnSinglePage: true }}
            onRow={(rec) => ({ onClick: () => { setDecisionProposal(rec); setPendingOpen(false); }, style: { cursor: 'pointer' } })}
            columns={[
              { title: 'Мера', dataIndex: 'riskTitle', render: (v: string, r) => v || r.metricName },
              { title: 'ИС', dataIndex: 'systemName', width: 180 },
              { title: '%', dataIndex: 'calculatedScore', width: 70,
                render: (v: number) => <Tag color={ragToken(v).color} style={{ color: '#fff', border: 'none' }}>{v}%</Tag>,
                sorter: (a, b) => a.calculatedScore - b.calculatedScore },
              { title: 'Срок', dataIndex: 'dueDate', width: 110 },
            ] as ColumnsType<Proposal>}
          />
        )}
      </Modal>

      {/* Все системы (по критичности) — раскрытие списка */}
      <Modal
        open={allOpen}
        onCancel={() => setAllOpen(false)}
        footer={null}
        width={760}
        title={`Все системы — оценка качества (${data.systems.length})`}
      >
        <Table<ExecSystemInsight>
          dataSource={[...data.systems].sort(
            (a, b) => (CRIT_RANK[a.criticality] - CRIT_RANK[b.criticality]) || (a.score - b.score),
          )}
          rowKey="id"
          size="small"
          pagination={{ pageSize: 10, hideOnSinglePage: true }}
          onRow={(rec) => ({ onClick: () => { setActive(rec); setAllOpen(false); }, style: { cursor: 'pointer' } })}
          columns={[
            { title: 'ИС', dataIndex: 'name' },
            {
              title: 'Критичность', dataIndex: 'criticality', width: 180,
              sorter: (a, b) => CRIT_RANK[a.criticality] - CRIT_RANK[b.criticality],
              render: (v: string) => <Tag style={critTagStyle(v)}>{v}</Tag>,
            },
            {
              title: 'Балл', dataIndex: 'score', width: 110,
              sorter: (a, b) => a.score - b.score,
              render: (v: number) => <Tag color={ragToken(v).color} style={{ color: '#fff', border: 'none' }}>{v}%</Tag>,
            },
            { title: 'Просевшая характеристика', dataIndex: 'weakCharacteristic', width: 220 },
          ] as ColumnsType<ExecSystemInsight>}
        />
      </Modal>
    </div>
  );
};

export default ExecutiveDashboard;
