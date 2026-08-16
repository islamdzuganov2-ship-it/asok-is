/**
 * ExecutiveDashboard.tsx — управленческий дашборд C-Level (CIO/CEO/CTO). ТЗ v9 §3.1.
 * Нативно подаёт проблематику + рекомендацию к действию; по клику — модал R1.5.
 * Спокойная RAG-палитра, минимум текста и цвета.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Card, Col, Row, Typography, Tag, Progress, Badge, Space, Button, Spin, Alert, Modal, Table } from 'antd';
import { RobotOutlined, FireOutlined, AppstoreOutlined, FundOutlined, UnorderedListOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import ReactECharts from 'echarts-for-react';
import { useSelector, shallowEqual } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { RootState } from '../../store';
import { ExecSystemInsight, ExecutiveDashboardData } from '../../data/mockDashboards';
import { EXECUTIVE_SCALE, HEATMAP_CHARS_FULL } from '../../data/mockScaleData';
import { RAG, ragToken, levelLabel, BRAND, critTagStyle, solidTagStyle, ACCENT } from '../../theme/ragPalette';
import { premiumCard, accentDot, pageContainer, pageTitle, GOLD, PREMIUM, TYPE, SPACE } from '../../theme/premium';
import { useChartTokens } from '../../theme/useThemeTokens';
import { numericColumn, sorterFor } from '../../theme/table';
import { parseRuDate } from '../../utils/dates';
import { SortButton, type HeatmapSortState } from '../../components/LevelHeatmap';
import { ActionInsightModal } from '../../components/ActionInsightModal';
import { MeasureDecisionModal } from '../../components/MeasureDecisionModal';
import { MeasuresRegistryCard } from '../../components/MeasuresRegistryCard';
import CollapsibleCard from '../../components/CollapsibleCard';
import MeasuresAiAnalyticsCard from '../../components/MeasuresAiAnalyticsCard';
import { TechDebtCard } from '../../components/TechDebtCard';
import EmployeeEffectivenessCard from '../../components/EmployeeEffectivenessCard';
import { selectVisibleProposals, type Proposal } from '../../store/slices/governanceSlice';
import { QUALITY_MODEL } from '../../constants/qualityModel';
import { useCharacteristicWeights } from '../../hooks/useCharacteristicWeights';

// Точное сопоставление меры с ячейкой теплокарты (по полному названию характеристики).
const norm = (s: string) => (s || '').toLowerCase().replace(/ё/g, 'е').replace(/[.\s]/g, '');

// Аббревиатуры характеристик для шапки теплокарты (паритет с моками: в демо шапка короткая).
const ABBR_BY_TITLE: Record<string, string> = Object.fromEntries(QUALITY_MODEL.map((c) => [c.title, c.abbr]));
const abbr = (c: string) => ABBR_BY_TITLE[c] ?? c;

// Только для явной сортировки столбца «Критичность» по клику в модалке «Все системы» (не для
// дефолтного ранжирования — см. ТЗ v20 п.2, buildExecFromLive).
const CRITICALITY_ORDER: Record<string, number> = {
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
  problematicSystems?: { id: string; name: string; criticality: string; lowMetricsCount: number; owner?: string | null; ownerUserId?: string | null }[];
  // ТЗ v19 п.15: за какой период(ы) собран показанный балл — разные ИС нередко на разных
  // последних периодах, молчать об этом значит не дать ответить на «за какой это срок».
  periodsUsed?: { distinct: string[]; earliest: string | null; latest: string | null; bySystem: Record<string, string> };
}

// Бакет уровня (0..5) → представительный % для RAG-индикации.
const BUCKET_SCORE = [-1, 10, 30, 50, 70, 90];

// Сборка структуры управленческого дашборда из реального ответа API (LLM-режим).
// ТЗ v20 п.2: балл ИС и ранжирование «Топ проблемных ИС» — по весам ГОСТ 25010 характеристики
// (charWeights, из GET /quality/weights), не по плоскому среднему бакетов — иначе просевшая, но
// маловесная характеристика тянула бы балл вниз наравне с весомой.
function buildExecFromLive(live: LiveDashboard | null, charWeights: Record<string, number>): ExecutiveDashboardData {
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
  // ТЗ v19 п.5 (УК-05): реальный ответственный за ИС (System.owner), не общая заглушка на
  // все системы — раньше здесь был один и тот же захардкоженный текст для любой ИС.
  const ownerMap = new Map((live.problematicSystems ?? []).map((s) => [s.name, s.owner]));

  const rows = sysNames.map((sys, y) => ({
    system: sys,
    cells: chars.map((_, x) => ({ score: BUCKET_SCORE[matrix[y][x]] ?? -1 })),
  }));

  const systems: ExecSystemInsight[] = sysNames.map((sys, y) => {
    const measured = chars
      .map((c, x) => ({ x, s: BUCKET_SCORE[matrix[y][x]] ?? -1, w: charWeights[c] ?? 0 }))
      .filter((m) => m.s >= 0);
    const weightApplied = measured.reduce((a, m) => a + m.w, 0);
    const score = weightApplied > 0
      ? Math.round(measured.reduce((a, m) => a + m.w * m.s, 0) / weightApplied)
      : (measured.length ? Math.round(measured.reduce((a, m) => a + m.s, 0) / measured.length) : 0);
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
      owner: ownerMap.get(sys) || 'не назначен',
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
  const { weights: charWeights } = useCharacteristicWeights();
  const pendingProposals = proposals.filter((p) => p.status === 'PENDING_APPROVAL');
  const pendingCount = pendingProposals.length;
  const [decisionProposal, setDecisionProposal] = useState<Proposal | null>(null);
  const [allOpen, setAllOpen] = useState(false);
  const [pendingOpen, setPendingOpen] = useState(false);
  const [showAllHeatmap, setShowAllHeatmap] = useState(false);
  const [heatSort, setHeatSort] = useState<HeatmapSortState>(null);
  // Реестр мер качества по умолчанию скрыт — раскрывается по кнопке.
  const [showRegistry, setShowRegistry] = useState(false);
  // ТЗ v19 п.3: переход «туда» из AI-карточки мер — характеристика, по которой кликнули.
  const [registryPreset, setRegistryPreset] = useState<string | null>(null);
  // Фокус на характеристике для карточки ИС (клик по ячейке теплокарты).
  const [activeChar, setActiveChar] = useState<string | undefined>(undefined);
  // Балл выбранной характеристики — для корректной карточки характеристики (T-56).
  const [activeCharScore, setActiveCharScore] = useState<number | undefined>(undefined);
  // ТЗ v20: настоящее AI-резюме по ИС (POST /reports/system-insight) — по кнопке, на замену
  // шаблонной строке «Интегральная оценка… Наиболее просевшая…», которая никогда не звала LLM,
  // хотя карточка была подписана «AI-резюме». По id ИС — у каждой карточки свой запрос.
  const [aiInsights, setAiInsights] = useState<Record<string, { loading: boolean; text?: string; error?: boolean }>>({});

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
    () => (isLive ? buildExecFromLive(live, charWeights) : EXECUTIVE_SCALE),
    [isLive, live, charWeights],
  );
  // Полные названия характеристик для сопоставления мер с ячейками (по режиму).
  const heatCharsFull = isLive ? data.heatmap.characteristics : HEATMAP_CHARS_FULL;

  // Разбивка каждой ИС по характеристикам (балл + вес ГОСТ 25010) — единый источник и для
  // взвешенного ранжирования, и для запроса AI-резюме по системе. Строится из ТЕХ ЖЕ данных,
  // что видны в тепловой карте (heatmap.rows), а не из мок-поля System.score: у демо-данных
  // это поле никогда не было взвешенным (отсюда «рандомный» на вид порядок карточек в демо).
  const charBreakdownOf = useMemo(() => {
    const map = new Map<string, { characteristic: string; score: number; weight: number }[]>();
    data.heatmap.rows.forEach((row) => {
      map.set(row.system, heatCharsFull.map((c, i) => ({
        characteristic: c, score: row.cells[i]?.score ?? -1, weight: charWeights[c] ?? 0,
      })));
    });
    return map;
  }, [data.heatmap.rows, heatCharsFull, charWeights]);

  // ТЗ v20 п.2: балл ранжирования — взвешенный по ГОСТ 25010, из charBreakdownOf, для ОБОИХ
  // режимов одинаково (раньше в демо использовался статичный мок-балл, в live — свой расчёт).
  const weightedScoreOf = useMemo(() => {
    const map = new Map<string, number>();
    charBreakdownOf.forEach((chars, sysName) => {
      const measured = chars.filter((c) => c.score >= 0);
      const totalWeight = measured.reduce((a, c) => a + c.weight, 0);
      const score = totalWeight > 0
        ? Math.round(measured.reduce((a, c) => a + c.score * c.weight, 0) / totalWeight)
        : (measured.length ? Math.round(measured.reduce((a, c) => a + c.score, 0) / measured.length) : 0);
      map.set(sysName, score);
    });
    return map;
  }, [charBreakdownOf]);

  // Системы с ПЕРЕОПРЕДЕЛЁННЫМ взвешенным баллом — единственный источник для карточек/списков/
  // модалок ниже (topCards/orderedHeatRows/allOpen/ActionInsightModal), чтобы цифра, по которой
  // сортируем, и цифра на бейдже всегда совпадали.
  const systems = useMemo(
    () => data.systems.map((s) => ({ ...s, score: weightedScoreOf.get(s.name) ?? s.score })),
    [data.systems, weightedScoreOf],
  );

  // ТЗ v20: настоящий вызов LLM по ИС — балл, веса характеристик (charBreakdownOf), связанные
  // технические сбои и уже выработанные меры собирает и обосновывает бэкенд (grounding, BL-005).
  const genSystemInsight = async (sys: ExecSystemInsight) => {
    setAiInsights((prev) => ({ ...prev, [sys.id]: { loading: true } }));
    try {
      const token = localStorage.getItem('token');
      const characteristics = charBreakdownOf.get(sys.name) ?? [];
      const r = await fetch(`${VITE_API}/reports/system-insight`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ system: sys.name, score: sys.score, criticality: sys.criticality, characteristics }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      setAiInsights((prev) => ({ ...prev, [sys.id]: { loading: false, text: d.analytics } }));
    } catch {
      setAiInsights((prev) => ({ ...prev, [sys.id]: { loading: false, error: true } }));
    }
  };

  // Зелёная точка — только если есть мера, ПО КОТОРОЙ НЕ ПРИНЯТО РЕШЕНИЕ (ожидает решения).
  const cellHasMeasure = (sys: string, fullChar: string) =>
    proposals.some((p) =>
      p.status === 'PENDING_APPROVAL'
      && norm(p.systemName) === norm(sys)
      && norm(p.characteristic) === norm(fullChar));

  // ТЗ v20 п.2: топ-3 проблемных ИС — по баллу качества, взвешенному по весам ГОСТ 25010
  // (тяжелее весом характеристика → сильнее тянет ранжирование), не по статичному полю
  // «класс критичности» и не по неучтённому мок-баллу.
  const topCards = [...systems]
    .sort((a, b) => a.score - b.score)
    .slice(0, 3);

  // Строки теплокарты: худшие по взвешенному баллу — первые. По умолчанию топ-5, остальное под кнопкой.
  const orderedHeatRows = [...data.heatmap.rows].sort((a, b) => {
    const sa = systems.find((s) => s.name === a.system);
    const sb = systems.find((s) => s.name === b.system);
    return (sa?.score ?? 100) - (sb?.score ?? 100);
  });
  // ТЗ v19 п.12: явная сортировка поверх дефолтного порядка (по критичности) — по клику на
  // стрелку в заголовке. Без активной сортировки — прежнее поведение (orderedHeatRows как есть).
  const sortedHeatRows = useMemo(() => {
    if (!heatSort) return orderedHeatRows;
    const sign = heatSort.dir === 'asc' ? 1 : -1;
    const rows = [...orderedHeatRows];
    if (heatSort.col === 'name') {
      return rows.sort((a, b) => sign * a.system.localeCompare(b.system, 'ru'));
    }
    return rows.sort((a, b) => {
      const va = a.cells[heatSort.col as number]?.score;
      const vb = b.cells[heatSort.col as number]?.score;
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return sign * (va - vb);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderedHeatRows.map((r) => r.system).join('|'), heatSort]);
  const shownHeatRows = showAllHeatmap ? sortedHeatRows : sortedHeatRows.slice(0, 5);

  const globalIndex = data.globalIndex;
  const idxTok = ragToken(globalIndex);
  // ECharts рисует на canvas и не понимает var() — берём конкретные цвета активной темы.
  const chart = useChartTokens();

  // ТЗ v20 п.5: под спидометром — в двух словах, какая характеристика просела заметнее всего
  // с учётом её веса (не просто самая низкая, а та, чья просадка весомее всего тянет индекс вниз).
  const gaugeCaption = useMemo(() => {
    if (!heatCharsFull.length || !data.heatmap.rows.length) return null;
    let worst: { char: string; avg: number; impact: number } | null = null;
    heatCharsFull.forEach((c, i) => {
      const scores = data.heatmap.rows
        .map((r) => r.cells[i]?.score)
        .filter((s): s is number => s != null && s >= 0);
      if (!scores.length) return;
      const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
      const impact = (100 - avg) * (charWeights[c] ?? 0);
      if (!worst || impact > worst.impact) worst = { char: c, avg, impact };
    });
    if (!worst || worst.avg >= 80) return 'Существенных просадок нет.';
    return `Просадка: страдает «${worst.char}» (${Math.round(worst.avg)}%).`;
  }, [heatCharsFull, data.heatmap.rows, charWeights]);

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
          pointer: { width: 4, length: '62%', itemStyle: { color: chart.ink } },
          axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: { show: false },
          anchor: { show: true, size: 10, itemStyle: { color: chart.ink } },
          detail: {
            valueAnimation: true,
            formatter: '{value}%',
            fontSize: TYPE.metricLg.fontSize,
            fontWeight: TYPE.metricLg.fontWeight,
            color: idxTok.color,
            offsetCenter: [0, '32%'],
          },
          data: [{ value: globalIndex }],
        },
      ],
    }),
    [globalIndex, idxTok.color, chart.ink],
  );

  return (
    <div style={pageContainer}>
      {/* Заголовок + общий индекс */}
      <Card {...premiumCard('gold')} style={{ ...premiumCard('gold').style, marginBottom: 16 }}>
        <Row align="middle" gutter={[16, 12]} wrap>
          <Col flex="auto" style={{ minWidth: 260 }}>
            <Title level={4} style={pageTitle}>
              <span style={accentDot(GOLD.base)} />Управленческий дашборд
            </Title>
            <Text type="secondary">
              Общий индекс качества ИТ-ландшафта:&nbsp;
              <Text strong style={{ color: idxTok.strong }}>
                {globalIndex}% · {levelLabel(globalIndex)}
              </Text>
              &nbsp;
              <Tag color={isLive ? 'green' : 'default'} style={{ marginLeft: 8 }}>
                {isLive ? 'LLM · live' : 'Демо'}
              </Tag>
            </Text>
            {isLive && live?.periodsUsed && live.periodsUsed.distinct.length > 0 && (
              <div>
                <Text type="secondary" style={{ fontSize: TYPE.caption.fontSize }}>
                  Данные за период{live.periodsUsed.distinct.length > 1 ? 'ы' : ''}:{' '}
                  {live.periodsUsed.distinct.length > 1
                    ? `${live.periodsUsed.earliest} – ${live.periodsUsed.latest} (разные ИС на разных последних периодах)`
                    : live.periodsUsed.latest}
                </Text>
              </div>
            )}
          </Col>
          <Col>
            <Badge count={pendingCount} offset={[-6, 6]} color={RAG.medium.color}>
              <Button onClick={() => setPendingOpen(true)}>Меры на одобрение</Button>
            </Badge>
          </Col>
          <Col>
            <div style={{ width: 200, flex: '0 0 auto' }}>
              <div style={{ height: 130 }}>
                <ReactECharts option={gaugeOption} style={{ height: '100%', width: '100%' }} />
              </div>
              {gaugeCaption && (
                <Text type="secondary" style={{ display: 'block', textAlign: 'center', fontSize: TYPE.caption.fontSize, marginTop: -8 }}>
                  {gaugeCaption}
                </Text>
              )}
            </div>
          </Col>
        </Row>
      </Card>

      {/* Live AI-резюме от встроенной LLM (только в режиме LLM) */}
      {isLive && (
        <Card {...premiumCard('slate')} style={{ ...premiumCard('slate').style, marginBottom: 16 }}>
          <Space align="start">
            {/* ui-audit-ignore UI-05 — оптическая подгонка иконки под базовую линию заголовка. */}
            <RobotOutlined style={{ color: BRAND.ink, fontSize: TYPE.metricSm.fontSize, marginTop: 2 }} />
            <div>
              <Text strong style={{ color: BRAND.ink }}>AI-резюме</Text>
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
                <Paragraph style={{ marginTop: 8, marginBottom: 0, fontSize: TYPE.bodySm.fontSize }}>{live.aiInsights}</Paragraph>
              )}
            </div>
          </Space>
        </Card>
      )}

      {/* Топ проблемных ИС — AI-аналитика по мерам (предложения LLM, не карточки) */}
      <MeasuresAiAnalyticsCard
        proposals={proposals}
        onOpenCharacteristic={(c) => { setShowRegistry(true); setRegistryPreset(c); }}
        onOpenInTaskPlan={(c) => navigate(`/dashboard/taskplan?characteristic=${encodeURIComponent(c)}`)}
      />

      {/* ТОП-3 проблемных ИС */}
      <Row align="middle" justify="space-between" style={{ marginBottom: 4 }}>
        <Col>
          <Title level={5} style={{ color: BRAND.ink, margin: 0 }}>
            <FireOutlined style={{ color: RAG.medium.color }} /> Топ проблемных ИС — требуют внимания
          </Title>
        </Col>
        <Col>
          <Button type="link" onClick={() => setAllOpen(true)}>Показать все системы →</Button>
        </Col>
      </Row>
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        {topCards.map((sys) => {
          const tok = ragToken(sys.score);
          const insight = aiInsights[sys.id];
          return (
            <Col xs={24} md={8} key={sys.id}>
              <Card
                hoverable
                onClick={() => setActive(sys)}
                style={{ borderColor: tok.border, background: tok.soft, height: '100%', borderRadius: PREMIUM.radius, boxShadow: PREMIUM.shadow.card }}
                styles={{ body: { padding: 16 } }}
              >
                <Space style={{ marginBottom: 8 }} wrap>
                  <Button
                    size="small"
                    type={insight?.text ? 'default' : 'primary'}
                    ghost={!!insight?.text}
                    icon={<RobotOutlined />}
                    loading={!!insight?.loading}
                    onClick={(e) => { e.stopPropagation(); genSystemInsight(sys); }}
                  >
                    {insight?.loading ? 'Генерация…' : insight?.text ? 'AI-резюме' : 'Собрать AI-резюме'}
                  </Button>
                  <Tag style={solidTagStyle(tok.strong)}>
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
                  style={{ fontSize: TYPE.bodySm.fontSize, marginBottom: 8 }}
                >
                  {insight?.error
                    ? 'Не удалось получить анализ LLM — попробуйте ещё раз или проверьте backend.'
                    : insight?.text ?? sys.aiSummary}
                </Paragraph>
                <Text strong style={{ fontSize: TYPE.bodySm.fontSize }}>
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
            title={<span style={{ color: BRAND.ink }}><span style={accentDot(ACCENT.slate.color)} /><AppstoreOutlined /> Тепловая карта характеристик</span>}
            extra={<Button type="link" size="small" onClick={() => navigate('/dashboard/analytics')}>Детали →</Button>}
            {...premiumCard('slate')}
            styles={{ header: premiumCard('slate').styles.header, body: { padding: SPACE.airy, overflowX: 'auto' } }}
          >
            <table style={{ borderCollapse: 'separate', borderSpacing: '0 8px', width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', fontWeight: 500, color: BRAND.inkSoft, fontSize: TYPE.caption.fontSize }}>
                    Система
                    <SortButton
                      active={heatSort?.col === 'name'} dir={heatSort?.dir}
                      label="Сортировать по названию системы"
                      onSort={() => setHeatSort((s) => (s?.col === 'name' ? { col: 'name', dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col: 'name', dir: 'asc' }))}
                    />
                  </th>
                  {data.heatmap.characteristics.map((c, i) => (
                    <th key={c} title={c} style={{ fontWeight: 500, color: BRAND.inkSoft, fontSize: TYPE.caption.fontSize, padding: '0 4px' }}>
                      {abbr(c)}
                      <SortButton
                        active={heatSort?.col === i} dir={heatSort?.dir}
                        label={`Сортировать по «${c}»`}
                        onSort={() => setHeatSort((s) => (s?.col === i ? { col: i, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col: i, dir: 'desc' }))}
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shownHeatRows.map((r) => {
                  const sys = systems.find((s) => s.name === r.system || s.name.includes(r.system));
                  return (
                    <tr key={r.system}>
                      <td
                        onClick={() => { if (sys) { setActiveChar(undefined); setActiveCharScore(undefined); setActive(sys); } }}
                        title="Открыть карточку ИС (кто отвечает, действия, все меры)"
                        style={{ fontSize: TYPE.bodySm.fontSize, color: BRAND.ink, paddingRight: 12, cursor: sys ? 'pointer' : 'default' }}
                      >{r.system}</td>
                      {r.cells.map((cell, i) => {
                        const measured = cellHasMeasure(r.system, heatCharsFull[i]);
                        return (
                          <td
                            key={i}
                            onClick={() => { if (sys) { setActiveChar(heatCharsFull[i]); setActiveCharScore(cell.score); setActive(sys); } }}
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
                  <Text type="secondary" style={{ fontSize: TYPE.caption.fontSize }}>{RAG[k].label}</Text>
                </Space>
              ))}
              <Space size={6}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: RAG.good.color, boxShadow: '0 0 0 2px #fff', display: 'inline-block' }} />
                <Text type="secondary" style={{ fontSize: TYPE.caption.fontSize }}>мера ожидает решения</Text>
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

      {/* Эффективность сотрудников (ТЗ v17, req 7) — под техдолгом и теплокартой */}
      <EmployeeEffectivenessCard proposals={proposals} style={{ marginTop: 16 }} />

      {/* Реестр мер качества — по умолчанию СВЁРНУТ, раскрывается по клику на шапку */}
      <CollapsibleCard
        accent="gold"
        style={{ marginTop: 16 }}
        title={<><UnorderedListOutlined /> Реестр мер качества</>}
        open={showRegistry}
        onToggle={(next) => { setShowRegistry(next); if (!next) setRegistryPreset(null); }}
      >
        <MeasuresRegistryCard proposals={proposals} onOpen={setDecisionProposal} presetCharacteristic={registryPreset} />
      </CollapsibleCard>

      <ActionInsightModal
        open={!!active}
        system={active}
        characteristic={activeChar}
        characteristicScore={activeCharScore}
        onClose={() => { setActive(null); setActiveChar(undefined); setActiveCharScore(undefined); }}
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
              { title: 'Мера', dataIndex: 'riskTitle', sorter: sorterFor((r: Proposal) => r.riskTitle || r.metricName),
                render: (v: string, r) => v || r.metricName },
              { title: 'ИС', dataIndex: 'systemName', width: 180, sorter: sorterFor((r: Proposal) => r.systemName) },
              numericColumn<Proposal>({ title: '%', dataIndex: 'calculatedScore', width: 70,
                render: (v: number) => <Tag style={solidTagStyle(ragToken(v).strong)}>{v}%</Tag>,
                sorter: (a, b) => a.calculatedScore - b.calculatedScore }),
              { title: 'Срок', dataIndex: 'dueDate', width: 110,
                sorter: sorterFor((r: Proposal) => parseRuDate(r.dueDate)?.getTime() ?? null) },
            ] as ColumnsType<Proposal>}
          />
        )}
      </Modal>

      {/* Все системы (по взвешенному баллу качества) — раскрытие списка */}
      <Modal
        open={allOpen}
        onCancel={() => setAllOpen(false)}
        footer={null}
        width={760}
        title={`Все системы — оценка качества (${systems.length})`}
      >
        <Table<ExecSystemInsight>
          dataSource={[...systems].sort((a, b) => a.score - b.score)}
          rowKey="id"
          size="small"
          pagination={{ pageSize: 10, hideOnSinglePage: true }}
          onRow={(rec) => ({ onClick: () => { setActive(rec); setAllOpen(false); }, style: { cursor: 'pointer' } })}
          columns={[
            { title: 'ИС', dataIndex: 'name', sorter: sorterFor((r: ExecSystemInsight) => r.name) },
            {
              title: 'Критичность', dataIndex: 'criticality', width: 180,
              sorter: (a, b) => (CRITICALITY_ORDER[a.criticality] ?? 9) - (CRITICALITY_ORDER[b.criticality] ?? 9),
              render: (v: string) => <Tag style={critTagStyle(v)}>{v}</Tag>,
            },
            numericColumn<ExecSystemInsight>({
              title: 'Балл', dataIndex: 'score', width: 110,
              sorter: (a, b) => a.score - b.score,
              render: (v: number) => <Tag style={solidTagStyle(ragToken(v).strong)}>{v}%</Tag>,
            }),
            { title: 'Просевшая характеристика', dataIndex: 'weakCharacteristic', width: 220,
              sorter: sorterFor((r: ExecSystemInsight) => r.weakCharacteristic) },
          ] as ColumnsType<ExecSystemInsight>}
        />
      </Modal>
    </div>
  );
};

export default ExecutiveDashboard;
