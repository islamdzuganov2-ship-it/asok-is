/**
 * ExecutiveDashboard.tsx — управленческий дашборд C-Level (CIO/CEO/CTO). ТЗ v9 §3.1.
 * Нативно подаёт проблематику + рекомендацию к действию; по клику — модал R1.5.
 * Спокойная RAG-палитра, минимум текста и цвета.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Card, Col, Row, Typography, Tag, Progress, Badge, Space, Button, Spin, Alert, Modal, Table, Segmented, Tooltip } from 'antd';
import { RobotOutlined, FireOutlined, AppstoreOutlined, FundOutlined, UnorderedListOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import ReactECharts from 'echarts-for-react';
import { useSelector, shallowEqual } from 'react-redux';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
import { fmtMoney } from '../../utils/money';

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

// УК-11: денежный слой теплокарты — грид ALE/ΔALE/покрытия за один запрос (risk-events/heatmap-money-layer).
interface HeatmapMoneyCell {
  systemName: string; characteristic: string;
  totalAle: number; totalDeltaAle: number; coveragePct: number;
}
type MoneyMode = 'score' | 'ale' | 'delta' | 'coverage';
const MONEY_MODE_OPTIONS: { value: MoneyMode; label: string }[] = [
  { value: 'score', label: 'Балл качества' },
  { value: 'ale', label: 'ALE под риском' },
  { value: 'delta', label: 'ΔALE снимаемый мерами' },
  { value: 'coverage', label: 'Покрытие мерами' },
];

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

// Второй уровень свёртки (портфель) — по критичности ИС, зеркало backend
// DEFAULT_CRITICALITY_WEIGHTS (weight_versions.py, В-6а). Нужно только для демо-режима: в
// live-режиме портфельный балл считает backend (portfolio_score) и приходит в globalHealthScore.
const CRITICALITY_WEIGHTS: Record<string, number> = {
  'MISSION CRITICAL': 3, 'BUSINESS CRITICAL': 2, 'BUSINESS OPERATIONAL': 1,
};

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

// `titleIsComplete` — режим денег (УК-11) передаёт готовый заголовок с реальными деньгами;
// `score` там — только внутренняя интенсивность цвета (0..100 нормировано к максимуму грида),
// не показатель для пользователя, поэтому обычный суффикс «: score%» (для баллов ГОСТ 25010) не нужен.
const RagDot: React.FC<{ score: number; size?: number; label?: string; titleIsComplete?: boolean }> = ({
  score, size = 14, label, titleIsComplete,
}) => (
  <span
    title={titleIsComplete ? (label ?? '') : `${label ? label + ': ' : ''}${score < 0 ? 'н/д' : score + '%'}`}
    style={{
      display: 'inline-block', width: size, height: size, borderRadius: '50%',
      background: ragToken(score).color, boxShadow: `0 0 0 3px ${ragToken(score).soft}`,
    }}
  />
);

const ExecutiveDashboard: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
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
  // УК-08/09: контекст перехода — в URL (?characteristic=…), не только в локальном state —
  // ссылку можно переслать коллеге, при открытии она сразу раскрывает реестр на нужной
  // характеристике (критерий приёмки п.3). Читаем один раз при монтировании страницы.
  useEffect(() => {
    const c = searchParams.get('characteristic');
    if (c) { setShowRegistry(true); setRegistryPreset(c); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const openRegistryFor = (c: string) => {
    setShowRegistry(true); setRegistryPreset(c);
    setSearchParams({ characteristic: c });
  };
  const closeRegistry = () => {
    setShowRegistry(false); setRegistryPreset(null);
    setSearchParams((sp) => { sp.delete('characteristic'); return sp; }, { replace: true });
  };
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

  // УК-11: денежный слой теплокарты — грузится лениво, только когда впервые переключают с
  // «Балл», не на каждой загрузке страницы (обогащение, не обязательный для дашборда путь).
  const [moneyMode, setMoneyMode] = useState<MoneyMode>('score');
  const [moneyLayer, setMoneyLayer] = useState<HeatmapMoneyCell[] | null>(null);
  const [moneyLoading, setMoneyLoading] = useState(false);
  // Переключатель денежных режимов скрыт в демо (см. ниже) — если ушли в демо, оставив
  // moneyMode на «ALE/ΔALE/покрытие», ячейки теплокарты рисовались бы пустыми пунктирными
  // кружками без денежного слоя и без способа вернуться на «Балл качества» через UI.
  useEffect(() => {
    if (!isLive) setMoneyMode('score');
  }, [isLive]);
  useEffect(() => {
    if (!isLive || moneyMode === 'score' || moneyLayer !== null) return;
    let alive = true;
    setMoneyLoading(true);
    const token = localStorage.getItem('token');
    fetch(`${VITE_API}/risk-events/heatmap-money-layer`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: HeatmapMoneyCell[]) => { if (alive) setMoneyLayer(d); })
      .catch(() => { if (alive) setMoneyLayer([]); })
      .finally(() => { if (alive) setMoneyLoading(false); });
    return () => { alive = false; };
  }, [isLive, moneyMode, moneyLayer]);

  const moneyByKey = useMemo(() => {
    const m = new Map<string, HeatmapMoneyCell>();
    (moneyLayer ?? []).forEach((c) => m.set(`${c.systemName}|${c.characteristic}`, c));
    return m;
  }, [moneyLayer]);
  // Нормировка ₽-режимов в 0..100 относительно максимума ТЕКУЩЕГО грида — своя шкала интенсивности
  // для каждого режима (score-бакеты 25010 тут не подходят, деньги не ограничены сверху).
  const moneyMax = useMemo(() => {
    const ale = Math.max(0, ...(moneyLayer ?? []).map((c) => c.totalAle));
    const delta = Math.max(0, ...(moneyLayer ?? []).map((c) => c.totalDeltaAle));
    return { ale, delta };
  }, [moneyLayer]);

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

  // УК-11: точка теплокарты в денежном режиме — своя шкала интенсивности на режим (деньги под
  // риском/ΔALE/покрытие), не бакеты score ГОСТ 25010. «Нет данных» (риски не заведены) — от
  // «нулевого значения» отличается отдельным флагом (критерий приёмки п.4).
  const moneyCellVisual = (sys: string, fullChar: string): { score: number; label: string; noData: boolean } => {
    const cell = moneyByKey.get(`${sys}|${fullChar}`);
    if (!cell) return { score: -1, label: 'риски не заведены', noData: true };
    if (moneyMode === 'ale') {
      const pct = moneyMax.ale > 0 ? (cell.totalAle / moneyMax.ale) * 100 : 0;
      return { score: 100 - pct, label: `ALE: ${fmtMoney(cell.totalAle)}/год`, noData: false };
    }
    if (moneyMode === 'delta') {
      const pct = moneyMax.delta > 0 ? (cell.totalDeltaAle / moneyMax.delta) * 100 : 0;
      return { score: pct, label: `ΔALE снимаемый мерами: ${fmtMoney(cell.totalDeltaAle)}/год`, noData: false };
    }
    // coverage
    return { score: cell.coveragePct, label: `Покрытие мерами: ${cell.coveragePct}% ALE`, noData: false };
  };

  // ТЗ v20 п.2: топ-3 проблемных ИС — по баллу качества, взвешенному по весам ГОСТ 25010
  // (тяжелее весом характеристика → сильнее тянет ранжирование), не по статичному полю
  // «класс критичности» и не по неучтённому мок-баллу.
  const topCards = [...systems]
    .sort((a, b) => a.score - b.score)
    .slice(0, 3);

  // По фидбэку (п.1, второй заход): карточка не должна показывать текст, оформленный как вывод
  // ИИ, если ИИ на самом деле не анализировал — раньше это решалось только подписью «Сводка по
  // метрикам», сам вывод ИИ ждал ручного клика. Теперь в режиме LLM реальный анализ по топ-3
  // системам запускается автоматически при открытии дашборда (по одному разу на систему за
  // время жизни компонента — firedInsightsRef, не аiInsights, чтобы не зависеть от гонки
  // состояния). В демо-режиме не трогаем: там нет живой LLM, дёргать нечего.
  const firedInsightsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!isLive) return;
    topCards.forEach((sys) => {
      if (firedInsightsRef.current.has(sys.id)) return;
      firedInsightsRef.current.add(sys.id);
      genSystemInsight(sys);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLive, topCards.map((s) => s.id).join('|')]);

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

  // П.11 (ТЗ v20/v19): в демо-режиме индекс раньше приходил статичным полем EXECUTIVE_SCALE.
  // globalIndex и не менялся при переключении весов ГОСТ 25010, хотя баллы карточек ниже
  // (systems/weightedScoreOf) уже пересчитывались — портфель и карточки расходились. Здесь
  // считаем тем же способом, что backend portfolio_score: свёртка взвешенных по характеристикам
  // баллов систем (systems[].score) по критичности (CRITICALITY_WEIGHTS).
  const globalIndex = useMemo(() => {
    if (isLive) return data.globalIndex;
    const totalW = systems.reduce((a, s) => a + (CRITICALITY_WEIGHTS[s.criticality] ?? 1), 0);
    if (!totalW) return data.globalIndex;
    const num = systems.reduce((a, s) => a + (CRITICALITY_WEIGHTS[s.criticality] ?? 1) * s.score, 0);
    return Math.round(num / totalW);
  }, [isLive, data.globalIndex, systems]);
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
        onOpenCharacteristic={openRegistryFor}
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
                {/* П.1: раньше карточка ДО клика по кнопке уже показывала абзац + «→ рекомендация» —
                    визуально неотличимо от настоящего вывода ИИ, хотя это шаблонный текст по цифрам
                    (sys.aiSummary/recommendation). Подпись явно называет источник, чтобы кнопка
                    «Собрать AI-резюме» не выглядела бесполезной («аналитика же и так уже тут»). */}
                <Text type="secondary" style={{ fontSize: TYPE.micro.fontSize, display: 'block', marginBottom: 2 }}>
                  {insight?.text ? '✓ Вывод ИИ (сгенерировано по кнопке)' : 'Сводка по метрикам — не заключение ИИ, нажмите кнопку выше'}
                </Text>
                <Paragraph
                  type="secondary"
                  ellipsis={{ rows: 3 }}
                  style={{ fontSize: TYPE.bodySm.fontSize, marginBottom: 8 }}
                >
                  {insight?.error
                    ? 'Не удалось получить анализ LLM — попробуйте ещё раз или проверьте backend.'
                    : insight?.text ?? sys.aiSummary}
                </Paragraph>
                {/* Шаблонная рекомендация — только пока нет настоящего вывода ИИ (не мешаем её
                    текстом, который уже содержит собственные выводы/следующие шаги). */}
                {!insight?.text && !insight?.error && (
                  <Text strong style={{ fontSize: TYPE.bodySm.fontSize }}>
                    → {sys.recommendation}
                  </Text>
                )}
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
            {/* УК-11: переключатель режима отображения — балл качества / деньги под риском /
                эффект мер / покрытие. Цветовая шкала точек перестраивается под режим (moneyCellVisual).
                По фидбэку (п.3, второй заход): в демо-режиме денежные режимы не работают (риски
                заводятся только в реестре, не в демо-наборе) — раньше кнопки всё равно рисовались,
                просто задизейбленными, и выглядели как «сломанные»/непонятные надписи. В демо
                переключатель вообще не показываем — там осмыслен только «Балл качества». */}
            {isLive ? (
              <Segmented
                size="small"
                value={moneyMode}
                onChange={(v) => setMoneyMode(v as MoneyMode)}
                options={MONEY_MODE_OPTIONS}
                style={{ marginBottom: SPACE.cozy }}
              />
            ) : (
              <Text type="secondary" style={{ display: 'block', fontSize: TYPE.caption.fontSize, marginBottom: SPACE.cozy }}>
                Режим: <Text strong style={{ fontSize: TYPE.caption.fontSize }}>Балл качества</Text> — денежные
                режимы (ALE/ΔALE/покрытие) считаются по реестру рисков и доступны только в режиме LLM.
              </Text>
            )}
            {moneyMode !== 'score' && isLive && moneyLoading && <Spin size="small" style={{ marginBottom: SPACE.cozy }} />}
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
                    <th key={c} style={{ fontWeight: 500, color: BRAND.inkSoft, fontSize: TYPE.caption.fontSize, padding: '0 4px' }}>
                      {/* П.3: сокращения — не «замаскированный» текст, а расшифровка по наведению;
                          раньше это был невидимый нативный title, теперь — та же подсказка, что и
                          везде в приложении (пунктирное подчёркивание = «здесь есть расшифровка»). */}
                      <Tooltip title={c}>
                        <span style={{ borderBottom: `1px dotted ${BRAND.inkSoft}`, cursor: 'help' }}>{abbr(c)}</span>
                      </Tooltip>
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
                        const money = moneyMode !== 'score' ? moneyCellVisual(r.system, heatCharsFull[i]) : null;
                        const dotScore = money ? money.score : cell.score;
                        const dotLabel = money
                          ? `${r.system} · ${heatCharsFull[i]} · ${money.label}`
                          : `${r.system} · ${heatCharsFull[i]}${measured ? ' · мера ожидает решения' : ''}`;
                        return (
                          <td
                            key={i}
                            onClick={() => { if (sys) { setActiveChar(heatCharsFull[i]); setActiveCharScore(cell.score); setActive(sys); } }}
                            title={`${heatCharsFull[i]} — карточка ИС с мерами по характеристике`}
                            style={{ textAlign: 'center', cursor: sys ? 'pointer' : 'default' }}
                          >
                            <span style={{ position: 'relative', display: 'inline-block', lineHeight: 0 }}>
                              {money?.noData ? (
                                <span
                                  title={dotLabel}
                                  style={{
                                    display: 'inline-block', width: 14, height: 14, borderRadius: '50%',
                                    border: `1.5px dashed ${BRAND.inkSoft}`, boxSizing: 'border-box',
                                  }}
                                />
                              ) : (
                                <RagDot score={dotScore} label={dotLabel} titleIsComplete={!!money} />
                              )}
                              {measured && !money && (
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
                  <Text type="secondary" style={{ fontSize: TYPE.caption.fontSize }}>
                    {moneyMode === 'score' ? RAG[k].label
                      : moneyMode === 'ale' ? (k === 'good' ? 'ALE низкий' : k === 'medium' ? 'ALE средний' : 'ALE высокий')
                      : moneyMode === 'delta' ? (k === 'good' ? 'ΔALE высокий' : k === 'medium' ? 'ΔALE средний' : 'ΔALE низкий')
                      : (k === 'good' ? 'покрытие высокое' : k === 'medium' ? 'покрытие среднее' : 'покрытие низкое')}
                  </Text>
                </Space>
              ))}
              {moneyMode === 'score' ? (
                <Space size={6}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: RAG.good.color, boxShadow: '0 0 0 2px #fff', display: 'inline-block' }} />
                  <Text type="secondary" style={{ fontSize: TYPE.caption.fontSize }}>мера ожидает решения</Text>
                </Space>
              ) : (
                <Space size={6}>
                  <span style={{ width: 12, height: 12, borderRadius: '50%', border: `1.5px dashed ${BRAND.inkSoft}`, boxSizing: 'border-box', display: 'inline-block' }} />
                  <Text type="secondary" style={{ fontSize: TYPE.caption.fontSize }}>риски не заведены (не то же самое, что 0 ₽)</Text>
                </Space>
              )}
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
      <EmployeeEffectivenessCard
        proposals={proposals}
        style={{ marginTop: 16 }}
        onSelectOwner={(o, status) => navigate(`/dashboard/taskplan?owner=${encodeURIComponent(o)}${status ? `&status=${encodeURIComponent(status)}` : ''}`)}
      />

      {/* Реестр мер качества — по умолчанию СВЁРНУТ, раскрывается по клику на шапку */}
      <CollapsibleCard
        accent="gold"
        style={{ marginTop: 16 }}
        title={<><UnorderedListOutlined /> Реестр мер качества</>}
        open={showRegistry}
        onToggle={(next) => { if (next) setShowRegistry(true); else closeRegistry(); }}
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
