/**
 * ExecScope.tsx — общее состояние карточек управленческого дашборда (CEO/CTO).
 *
 * Перенесено из ExecutiveDashboard без изменения расчётов: взвешивание по ГОСТ 25010
 * (ТЗ v20 п.2), портфельный индекс по критичности, денежный слой теплокарты (УК-11), AI-резюме
 * по ИС (ТЗ v20), контекст перехода в реестр мер через ?characteristic= (УК-08/09).
 *
 * Все модалки (карточка ИС, решение по мере, «меры на одобрение», «все системы») держит скоуп:
 * иначе карточка «Тепловая карта», унесённая на «Мой дашборд», кликалась бы в пустоту.
 */
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useSelector, shallowEqual } from 'react-redux';
import { useSearchParams } from 'react-router-dom';
import type { RootState } from '../../store';
import type { ExecSystemInsight, ExecutiveDashboardData } from '../../data/mockDashboards';
import { EXECUTIVE_SCALE, HEATMAP_CHARS_FULL } from '../../data/mockScaleData';
import { fmtMoney } from '../../utils/money';
import { ActionInsightModal } from '../../components/ActionInsightModal';
import { MeasureDecisionModal } from '../../components/MeasureDecisionModal';
import type { HeatmapSortState } from '../../components/LevelHeatmap';
import { QUALITY_MODEL } from '../../constants/qualityModel';
import { useCharacteristicWeights } from '../../hooks/useCharacteristicWeights';
import { selectVisibleProposals, type Proposal } from '../../store/slices/governanceSlice';
import ExecListModals from './execListModals';

const VITE_API = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api/v1';

const norm = (s: string) => (s || '').toLowerCase().replace(/ё/g, 'е').replace(/[.\s]/g, '');

const ABBR_BY_TITLE: Record<string, string> = Object.fromEntries(QUALITY_MODEL.map((c) => [c.title, c.abbr]));
export const abbr = (c: string) => ABBR_BY_TITLE[c] ?? c;

const CRITICALITY_WEIGHTS: Record<string, number> = {
  'MISSION CRITICAL': 3, 'BUSINESS CRITICAL': 2, 'BUSINESS OPERATIONAL': 1,
};
const BUCKET_SCORE = [-1, 10, 30, 50, 70, 90];

interface HeatmapMoneyCell {
  systemName: string; characteristic: string;
  totalAle: number; totalDeltaAle: number; coveragePct: number;
}
export type MoneyMode = 'score' | 'ale' | 'delta' | 'coverage';
export const MONEY_MODE_OPTIONS: { value: MoneyMode; label: string }[] = [
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
  periodsUsed?: { distinct: string[]; earliest: string | null; latest: string | null; bySystem: Record<string, string> };
}

/** Сборка структуры дашборда из реального ответа API (LLM-режим). Перенесено дословно. */
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

interface ExecScopeValue {
  isLive: boolean;
  live: LiveDashboard | null;
  liveLoading: boolean;
  liveError: string | null;
  data: ExecutiveDashboardData;
  heatCharsFull: string[];
  systems: ExecSystemInsight[];
  proposals: Proposal[];
  pendingProposals: Proposal[];
  pendingCount: number;
  globalIndex: number;
  gaugeCaption: string | null;
  topCards: ExecSystemInsight[];
  aiInsights: Record<string, { loading: boolean; text?: string; error?: boolean }>;
  genSystemInsight: (sys: ExecSystemInsight) => Promise<void>;
  // Теплокарта
  moneyMode: MoneyMode;
  setMoneyMode: (m: MoneyMode) => void;
  moneyLoading: boolean;
  moneyCellVisual: (sys: string, fullChar: string) => { score: number; label: string; noData: boolean };
  cellHasMeasure: (sys: string, fullChar: string) => boolean;
  heatSort: HeatmapSortState;
  setHeatSort: React.Dispatch<React.SetStateAction<HeatmapSortState>>;
  orderedHeatRows: ExecutiveDashboardData['heatmap']['rows'];
  sortedHeatRows: ExecutiveDashboardData['heatmap']['rows'];
  showAllHeatmap: boolean;
  setShowAllHeatmap: (v: boolean) => void;
  // Реестр мер
  showRegistry: boolean;
  registryPreset: string | null;
  openRegistryFor: (c: string) => void;
  closeRegistry: () => void;
  setShowRegistry: (v: boolean) => void;
  // Модалки
  openSystem: (sys: ExecSystemInsight, characteristic?: string, score?: number) => void;
  openMeasure: (p: Proposal) => void;
  openPending: () => void;
  openAllSystems: () => void;
}

const Ctx = createContext<ExecScopeValue | null>(null);

export function useExecScope(): ExecScopeValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('Карточка управленческого дашборда отрисована вне ExecScope');
  return v;
}

export const ExecScopeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const dataMode = useSelector((s: RootState) => s.ui.dataMode);
  const isLive = dataMode === 'live';
  const proposals = useSelector(selectVisibleProposals, shallowEqual);
  const { weights: charWeights } = useCharacteristicWeights();

  const [active, setActive] = useState<ExecSystemInsight | null>(null);
  const [activeChar, setActiveChar] = useState<string | undefined>(undefined);
  const [activeCharScore, setActiveCharScore] = useState<number | undefined>(undefined);
  const [decisionProposal, setDecisionProposal] = useState<Proposal | null>(null);
  const [allOpen, setAllOpen] = useState(false);
  const [pendingOpen, setPendingOpen] = useState(false);
  const [showAllHeatmap, setShowAllHeatmap] = useState(false);
  const [heatSort, setHeatSort] = useState<HeatmapSortState>(null);
  const [showRegistry, setShowRegistry] = useState(false);
  const [registryPreset, setRegistryPreset] = useState<string | null>(null);
  const [aiInsights, setAiInsights] = useState<Record<string, { loading: boolean; text?: string; error?: boolean }>>({});

  const [live, setLive] = useState<LiveDashboard | null>(null);
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);

  const [moneyMode, setMoneyMode] = useState<MoneyMode>('score');
  const [moneyLayer, setMoneyLayer] = useState<HeatmapMoneyCell[] | null>(null);
  const [moneyLoading, setMoneyLoading] = useState(false);

  // УК-08/09: контекст перехода живёт в URL — ссылку можно переслать коллеге.
  useEffect(() => {
    const c = searchParams.get('characteristic');
    if (c) { setShowRegistry(true); setRegistryPreset(c); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (!isLive) setMoneyMode('score'); }, [isLive]);

  useEffect(() => {
    if (!isLive || moneyMode === 'score' || moneyLayer !== null) return;
    let alive = true;
    setMoneyLoading(true);
    const token = localStorage.getItem('token');
    fetch(`${VITE_API}/risk-events/heatmap-money-layer`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: HeatmapMoneyCell[]) => { if (alive) setMoneyLayer(d); })
      .catch(() => { if (alive) setMoneyLayer([]); })
      .finally(() => { if (alive) setMoneyLoading(false); });
    return () => { alive = false; };
  }, [isLive, moneyMode, moneyLayer]);

  useEffect(() => {
    if (!isLive) { setLive(null); setLiveError(null); return; }
    let alive = true;
    setLiveLoading(true);
    setLiveError(null);
    const token = localStorage.getItem('token');
    fetch(`${VITE_API}/reports/executive-dashboard`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: LiveDashboard) => { if (alive) setLive(d); })
      .catch((e) => { if (alive) setLiveError(e.message); })
      .finally(() => { if (alive) setLiveLoading(false); });
    return () => { alive = false; };
  }, [isLive]);

  const data: ExecutiveDashboardData = useMemo(
    () => (isLive ? buildExecFromLive(live, charWeights) : EXECUTIVE_SCALE),
    [isLive, live, charWeights],
  );
  const heatCharsFull = isLive ? data.heatmap.characteristics : HEATMAP_CHARS_FULL;

  const charBreakdownOf = useMemo(() => {
    const map = new Map<string, { characteristic: string; score: number; weight: number }[]>();
    data.heatmap.rows.forEach((row) => {
      map.set(row.system, heatCharsFull.map((c, i) => ({
        characteristic: c, score: row.cells[i]?.score ?? -1, weight: charWeights[c] ?? 0,
      })));
    });
    return map;
  }, [data.heatmap.rows, heatCharsFull, charWeights]);

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

  const systems = useMemo(
    () => data.systems.map((s) => ({ ...s, score: weightedScoreOf.get(s.name) ?? s.score })),
    [data.systems, weightedScoreOf],
  );

  const pendingProposals = proposals.filter((p) => p.status === 'PENDING_APPROVAL');

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

  const topCards = [...systems].sort((a, b) => a.score - b.score).slice(0, 3);

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

  const moneyByKey = useMemo(() => {
    const m = new Map<string, HeatmapMoneyCell>();
    (moneyLayer ?? []).forEach((c) => m.set(`${c.systemName}|${c.characteristic}`, c));
    return m;
  }, [moneyLayer]);
  const moneyMax = useMemo(() => ({
    ale: Math.max(0, ...(moneyLayer ?? []).map((c) => c.totalAle)),
    delta: Math.max(0, ...(moneyLayer ?? []).map((c) => c.totalDeltaAle)),
  }), [moneyLayer]);

  const moneyCellVisual = (sys: string, fullChar: string) => {
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
    return { score: cell.coveragePct, label: `Покрытие мерами: ${cell.coveragePct}% ALE`, noData: false };
  };

  const cellHasMeasure = (sys: string, fullChar: string) =>
    proposals.some((p) =>
      p.status === 'PENDING_APPROVAL'
      && norm(p.systemName) === norm(sys)
      && norm(p.characteristic) === norm(fullChar));

  const orderedHeatRows = [...data.heatmap.rows].sort((a, b) => {
    const sa = systems.find((s) => s.name === a.system);
    const sb = systems.find((s) => s.name === b.system);
    return (sa?.score ?? 100) - (sb?.score ?? 100);
  });
  const sortedHeatRows = useMemo(() => {
    if (!heatSort) return orderedHeatRows;
    const sign = heatSort.dir === 'asc' ? 1 : -1;
    const rows = [...orderedHeatRows];
    if (heatSort.col === 'name') return rows.sort((a, b) => sign * a.system.localeCompare(b.system, 'ru'));
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

  const globalIndex = useMemo(() => {
    if (isLive) return data.globalIndex;
    const totalW = systems.reduce((a, s) => a + (CRITICALITY_WEIGHTS[s.criticality] ?? 1), 0);
    if (!totalW) return data.globalIndex;
    const num = systems.reduce((a, s) => a + (CRITICALITY_WEIGHTS[s.criticality] ?? 1) * s.score, 0);
    return Math.round(num / totalW);
  }, [isLive, data.globalIndex, systems]);

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
    if (!worst) return null;
    const w = worst as { char: string; avg: number; impact: number };
    if (w.avg >= 80) return 'Существенных просадок нет.';
    return `Просадка: страдает «${w.char}» (${Math.round(w.avg)}%).`;
  }, [heatCharsFull, data.heatmap.rows, charWeights]);

  const value: ExecScopeValue = {
    isLive, live, liveLoading, liveError,
    data, heatCharsFull, systems, proposals, pendingProposals, pendingCount: pendingProposals.length,
    globalIndex, gaugeCaption, topCards, aiInsights, genSystemInsight,
    moneyMode, setMoneyMode, moneyLoading, moneyCellVisual, cellHasMeasure,
    heatSort, setHeatSort, orderedHeatRows, sortedHeatRows, showAllHeatmap, setShowAllHeatmap,
    showRegistry, registryPreset, setShowRegistry,
    openRegistryFor: (c: string) => { setShowRegistry(true); setRegistryPreset(c); setSearchParams({ characteristic: c }); },
    closeRegistry: () => {
      setShowRegistry(false); setRegistryPreset(null);
      setSearchParams((sp) => { sp.delete('characteristic'); return sp; }, { replace: true });
    },
    openSystem: (sys, characteristic, score) => { setActiveChar(characteristic); setActiveCharScore(score); setActive(sys); },
    openMeasure: setDecisionProposal,
    openPending: () => setPendingOpen(true),
    openAllSystems: () => setAllOpen(true),
  };

  return (
    <Ctx.Provider value={value}>
      {children}
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
      <ExecListModals
        pendingOpen={pendingOpen}
        onClosePending={() => setPendingOpen(false)}
        pendingProposals={pendingProposals}
        allOpen={allOpen}
        onCloseAll={() => setAllOpen(false)}
        systems={systems}
        onPickProposal={(p) => { setDecisionProposal(p); setPendingOpen(false); }}
        onPickSystem={(s) => { setActive(s); setAllOpen(false); }}
      />
    </Ctx.Provider>
  );
};

/** У управленческого скоупа общего управления над сеткой нет: режим Демо/LLM живёт в шапке
 *  приложения, а период показывает карточка индекса. Заглушка нужна, чтобы контракт скоупов
 *  оставался одинаковым. */
export const ExecScopeToolbar: React.FC = () => null;
