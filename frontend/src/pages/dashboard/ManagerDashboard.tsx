/**
 * ManagerDashboard.tsx — дашборд «Основное» роли «Менеджер по качеству» (ТЗ v9 §3.2 + v15).
 *
 * Логика раскрытия (ТЗ v15, T-27…T-30):
 *  0) Карточка-пирог «Профиль качества по характеристикам» — интерактивный селектор
 *     (клик по сектору выбирает характеристику; центр доната — интегральный балл ИС).
 *  1) Карточка «Метрики характеристики «X»» появляется ТОЛЬКО по выбранной характеристике,
 *     с опцией «Спрятать» (T-28).
 *  2) Каскад (T-29): при выборе характеристики раскрывается карточка подхарактеристик (метрики);
 *     если на характеристику есть меры — раскрывается карточка «Меры и намерения»; если мер нет —
 *     меры и «Профессиональные суждения» не раскрываются, пока не выбрана подхарактеристика.
 *
 * Режим данных:
 *  - 'mock' (Демо) — масштабный демо-набор (30 ИС) из mockScaleData;
 *  - 'live' (LLM)  — РЕАЛЬНЫЕ оценки из БД (GET /assessments/dashboard → systemDetails).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Card, Col, Row, Typography, Table, Tag, Button, Select, Space, List, Spin, Empty } from 'antd';
import {
  EditOutlined, CheckCircleOutlined, ClockCircleOutlined, CloseCircleOutlined, DatabaseOutlined,
  EyeInvisibleOutlined, PieChartOutlined,
} from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import { useSelector, shallowEqual } from 'react-redux';
import { RootState } from '../../store';
import { ManagerMetric, ManagerSystem } from '../../data/mockDashboards';
import { MANAGER_SCALE_SYSTEMS as MANAGER_MOCK_SYSTEMS } from '../../data/mockScaleData';
import { RAG, ragToken, levelLabel, BRAND } from '../../theme/ragPalette';
import { premiumCard, accentDot, pageContainer, pageTitle, GOLD } from '../../theme/premium';
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
// Нормализация названий характеристик/подхарактеристик (ё/е, регистр, пробелы) — как в теплокарте.
const norm = (s: string) => (s || '').toLowerCase().replace(/ё/g, 'е').replace(/[.\s]/g, '');

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
  // По умолчанию характеристика НЕ выбрана — карточка метрик и каскад раскрываются по выбору (T-28/T-29).
  const [charKey, setCharKey] = useState<string | undefined>(undefined);
  const [subName, setSubName] = useState<string | undefined>(undefined);
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
        if (mapped.length) setSystemId(mapped[0].id);
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

  // При смене ИС каскад начинается заново (ничего не выбрано).
  useEffect(() => {
    setCharKey(undefined);
    setSubName(undefined);
    setShowAllMeasures(false);
  }, [systemId, system?.id]);

  const visibleProposals = useSelector(selectVisibleProposals, shallowEqual);
  const myProposals = useMemo(
    () => (system ? visibleProposals.filter((p) => p.systemName === system.name) : []),
    [visibleProposals, system?.name],
  );

  // Выбранная характеристика (undefined, пока не выбрана на пироге/в списке).
  const characteristic = charKey ? system?.characteristics.find((c) => c.key === charKey) : undefined;
  const charTok = scoreTok(characteristic?.score ?? -1);

  // Каскад раскрытия (T-29): меры/суждения — по характеристике или выбранной подхарактеристике.
  const charMeasures = useMemo(
    () => (characteristic ? myProposals.filter((p) => norm(p.characteristic) === norm(characteristic.title)) : []),
    [myProposals, characteristic?.title],
  );
  const subMeasures = useMemo(
    () => (subName ? charMeasures.filter((p) => norm(p.metricName) === norm(subName)) : []),
    [charMeasures, subName],
  );
  const hasCharMeasures = charMeasures.length > 0;
  const measuresList = subName && subMeasures.length ? subMeasures : charMeasures;
  const shownProposals = useMemo(() => {
    const sorted = [...measuresList].sort((a, b) => a.calculatedScore - b.calculatedScore);
    return showAllMeasures ? sorted : sorted.slice(0, 3);
  }, [measuresList, showAllMeasures]);

  // Что раскрыто в каскаде (карточки показываются только когда по выбору есть содержимое):
  const showMetrics = !!characteristic;
  const showMeasures = !!characteristic && (hasCharMeasures || subMeasures.length > 0);

  // Интегральный балл ИС (для центра доната) = среднее измеримых характеристик.
  const integral = useMemo(() => {
    const meas = system?.characteristics.filter((c) => c.score >= 0) ?? [];
    return meas.length ? Math.round(meas.reduce((a, c) => a + c.score, 0) / meas.length) : -1;
  }, [system?.id]);

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
          fontSize: 24, fontWeight: 700, color: charTok.color, offsetCenter: [0, '34%'],
        },
        data: [{ value: Math.max(0, characteristic?.score ?? 0) }],
      }],
    }),
    [characteristic?.score, charTok.color],
  );

  // Пирог-селектор: 8 характеристик ИС, окраска по RAG, клик по сектору → выбор характеристики.
  const pieOption = useMemo(() => {
    if (!system) return {};
    return {
      // Легенда под бубликом убрана намеренно: справа есть список-легенда, а наведение на
      // сектор показывает наименование характеристики во всплывашке.
      tooltip: {
        trigger: 'item', confine: true,
        formatter: (p: any) => `${p.marker} ${p.name}<br/><b>${p.data.raw < 0 ? 'н/д' : `${p.data.raw}%`}</b>`,
      },
      title: {
        text: integral < 0 ? 'н/д' : `${integral}%`,
        subtext: 'интегральный балл',
        left: 'center', top: '42%',
        textStyle: { color: BRAND.ink, fontSize: 28, fontWeight: 800 },
        subtextStyle: { color: '#8a94a6', fontSize: 11 },
      },
      series: [{
        type: 'pie', radius: ['56%', '82%'], center: ['50%', '50%'], avoidLabelOverlap: true,
        itemStyle: { borderColor: '#fff', borderWidth: 3, borderRadius: 6 },
        label: { show: false }, labelLine: { show: false },
        emphasis: { scale: true, scaleSize: 6, itemStyle: { shadowBlur: 16, shadowColor: 'rgba(43,58,75,.22)' } },
        data: system.characteristics.map((c) => ({
          name: c.title,
          value: c.score < 0 ? 3 : Math.max(3, c.score),
          raw: c.score,
          itemStyle: { color: scoreTok(c.score).color, opacity: charKey && c.key !== charKey ? 0.42 : 1 },
        })),
      }],
    };
  }, [system?.id, integral, charKey]);

  const selectChar = (key: string) => { setCharKey(key); setSubName(undefined); setShowAllMeasures(false); };
  const hideChar = () => { setCharKey(undefined); setSubName(undefined); };

  const columns = [
    { title: 'Метрика (подхарактеристика)', dataIndex: 'name', key: 'name', width: '46%' },
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
          onClick={(e) => {
            e.stopPropagation();
            if (system && characteristic) setTarget({
              systemName: system.name, characteristic: characteristic.title, metricName: r.name, score: Math.max(0, r.score),
            });
          }}
        >
          Суждение
        </Button>
      ),
    },
  ];

  const showData = !!system;

  return (
    <div style={pageContainer}>
      <Row align="middle" justify="space-between" gutter={[16, 8]} wrap>
        <Col>
          <Title level={4} style={pageTitle}>
            <PieChartOutlined style={{ color: GOLD.base, marginRight: 8 }} />Основное
          </Title>
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
          description="Заполните и финализируйте оценку в разделе «Внесение данных» — система появится здесь." />
      )}

      {showData && (
        <>
          {/* Профиль качества — бублик слева (в той же колонке, что спидометр в «Метриках»),
              справа — легенда-СПИСОК характеристик (как список в карточке «Метрики характеристики»). */}
          <Card
            {...premiumCard('gold', { marginTop: 16 })}
            title={
              <Space>
                <span style={accentDot(GOLD.base)} />
                <span style={{ color: BRAND.ink }}>Профиль качества по характеристикам</span>
              </Space>
            }
            extra={<Text type="secondary" style={{ fontSize: 12 }}>клик по сектору или строке справа — выбрать характеристику</Text>}
          >
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center' }}>
              {/* Бублик — левая колонка фиксированной ширины (совпадает со спидометром ниже) */}
              <div style={{ flex: '0 0 260px', minWidth: 240 }}>
                <ReactECharts
                  option={pieOption}
                  notMerge
                  style={{ height: 260, width: '100%' }}
                  onEvents={{
                    click: (p: any) => {
                      const c = system!.characteristics.find((x) => x.title === p?.data?.name);
                      if (c) selectChar(c.key);
                    },
                  }}
                />
              </div>
              {/* Легенда-список: строка на характеристику (цвет + название + балл), клик = выбор */}
              <div style={{ flex: 1, minWidth: 280, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {system!.characteristics.map((c) => {
                  const active = c.key === charKey;
                  const tok = scoreTok(c.score);
                  return (
                    <div
                      key={c.key}
                      role="button"
                      tabIndex={0}
                      data-char={c.title}
                      onClick={() => selectChar(c.key)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectChar(c.key); } }}
                      style={{
                        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                        padding: '7px 12px', borderRadius: 10,
                        background: active ? tok.soft : 'transparent',
                        border: `1px solid ${active ? tok.border : 'transparent'}`,
                        transition: 'all .15s ease', userSelect: 'none',
                      }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
                        <span style={{ width: 10, height: 10, borderRadius: '50%', background: tok.color, flex: '0 0 auto', boxShadow: `0 0 0 3px ${tok.soft}` }} />
                        <span style={{ color: BRAND.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: active ? 600 : 400 }}>{c.title}</span>
                      </span>
                      <b style={{ color: tok.color, flex: '0 0 auto', fontVariantNumeric: 'tabular-nums' }}>{c.score < 0 ? 'н/д' : `${c.score}%`}</b>
                    </div>
                  );
                })}
              </div>
            </div>
          </Card>

          {/* Метрики характеристики — ПОД профилем; спидометр в ТОЙ ЖЕ левой колонке (под бубликом) */}
          {showMetrics && (
            <Card
              {...premiumCard('ink', { marginTop: 16 })}
              title={
                <Space wrap>
                  <span style={accentDot(charTok.color)} />
                  <span style={{ color: BRAND.ink }}>Метрики характеристики «{characteristic!.title}»</span>
                  <Tag color={charTok.color} style={{ color: '#fff', border: 'none' }}>
                    {characteristic!.score < 0 ? 'н/д' : `${characteristic!.score}%`}
                  </Tag>
                </Space>
              }
              extra={<Button size="small" icon={<EyeInvisibleOutlined />} onClick={hideChar}>Спрятать</Button>}
            >
              <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                {/* Спидометр — левая колонка той же ширины (260px), что и бублик выше → они на одном уровне */}
                <div style={{ flex: '0 0 260px', minWidth: 240, display: 'flex', justifyContent: 'center', alignItems: 'flex-start' }}>
                  <div style={{ width: 214, height: 190 }}>
                    <ReactECharts option={gaugeOption} style={{ height: '100%', width: '100%' }} />
                  </div>
                </div>
                <div style={{ flex: 1, minWidth: 300 }}>
                  <Table<ManagerMetric>
                    dataSource={characteristic!.metrics}
                    columns={columns}
                    rowKey="id"
                    size="small"
                    pagination={false}
                    onRow={(r) => ({
                      onClick: () => setSubName(r.name === subName ? undefined : r.name),
                      style: { cursor: 'pointer', background: r.name === subName ? '#EEF3F8' : undefined },
                    })}
                    locale={{ emptyText: <Empty description="Нет метрик" /> }}
                  />
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    Клик по строке — выбрать подхарактеристику (уточняет меры и суждения по ней).
                  </Text>
                </div>
              </div>
            </Card>
          )}
        </>
      )}

      {/* Выработка мер — завязана на выбранную характеристику; карточка показывается ТОЛЬКО если
          по этой характеристике есть систематическая проблема (иначе не раскрывается) */}
      {showMetrics && (
        <MeasureDevelopmentPanel
          systemName={system!.name}
          system={system}
          characteristic={characteristic!.title}
          hideWhenEmpty
        />
      )}

      {/* Меры и намерения — раскрываются только когда меры по характеристике/подхарактеристике есть */}
      {showMeasures && (
        <Card
          {...premiumCard('terracotta', { marginTop: 16 })}
          title={
            <Space wrap>
              <span style={accentDot('#C06B5A')} />
              <span style={{ color: BRAND.ink }}>Меры и намерения — характеристика «{characteristic!.title}»</span>
              {subName && <Tag>{subName}</Tag>}
            </Space>
          }
        >
          {measuresList.length === 0 ? (
            <Text type="secondary">
              По выбору мер пока нет. Откройте «Суждение» по метрике, чтобы зафиксировать
              профессиональное суждение и поставить задачу — она уйдёт топ-менеджменту на одобрение.
            </Text>
          ) : (
            <List
              dataSource={shownProposals}
              footer={measuresList.length > 3 ? (
                <div style={{ textAlign: 'center' }}>
                  <Button type="link" onClick={() => setShowAllMeasures(!showAllMeasures)}>
                    {showAllMeasures ? 'Свернуть' : `Показать все (${measuresList.length})`}
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
      )}

      {/* Профессиональные суждения — завязаны на характеристику/подхарактеристику; карточка
          показывается ТОЛЬКО если суждения есть (self-hide при пустоте) */}
      {showMetrics && (
        <FilledJudgmentsCard systemName={system!.name} characteristic={characteristic!.title} sub={subName} hideWhenEmpty />
      )}

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
