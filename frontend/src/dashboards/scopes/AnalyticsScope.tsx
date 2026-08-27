/**
 * AnalyticsScope.tsx — общее состояние карточек «Аналитического дашборда качества ИС».
 *
 * Один ответ /assessments/dashboard кормит все четыре карточки: KPI, распределение уровней,
 * проблемные ИС, теплокарта. Запрашивать его в каждой карточке отдельно значило бы четыре
 * одинаковых запроса при открытии; здесь он один на скоуп.
 *
 * Три модалки-раскрытия (что входит в KPI, подхарактеристики характеристики, просевшие метрики
 * конкретной ИС) тоже здесь — их открывают разные карточки.
 */
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Modal } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useSelector, shallowEqual } from 'react-redux';
import type { RootState } from '../../store';
import { selectVisibleProposals } from '../../store/slices/governanceSlice';
import { ANALYTICS_SCALE } from '../../data/mockScaleData';
import { ragToken } from '../../theme/ragPalette';
import { useCharacteristicWeights } from '../../hooks/useCharacteristicWeights';
import {
  AnalyticsDetail, AnalyticsCharModal, AnalyticsSystemLowModal, DETAIL_TITLE, type DetailKey,
} from './analyticsModals';

const VITE_API = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api/v1';

export const LEVEL_ORDER = [
  'Высокий уровень', 'Выше среднего', 'Средний уровень',
  'Ниже среднего', 'Низкий уровень', 'Невозможно измерить',
];

export interface SubDetail { name: string; score: number }
export interface CharDetail { title: string; abbr: string; score: number; subs: SubDetail[] }

export interface SystemContribution {
  system: string; criticality: string | null; score: number;
  criticalityWeight: number; pointsContribution: number;
}
interface PortfolioBreakdown { criticalityWeightApplied: number; systemContributions: SystemContribution[] }
interface SubcharContribution { characteristic: string; subcharacteristic: string; weight: number; x: number; pointsContribution: number }
export interface SystemScoreBreakdown { coverage: number; weightApplied: number; weightTotal: number; contributions: SubcharContribution[] }

export interface DashboardData {
  globalHealthScore: number;
  levelCounts: Record<string, number>;
  heatmapData: [number, number, number][];
  xAxisLabels: string[];
  yAxisLabels: string[];
  problematicSystems: { id: string; name: string; criticality: string; lowMetricsCount: number }[];
  totalMetrics: number;
  characteristics?: CharDetail[];
  systemDetails?: { name: string; chars: CharDetail[]; scoreBreakdown?: SystemScoreBreakdown }[];
  scoreBreakdown?: PortfolioBreakdown;
}

type CharModal = CharDetail & { system?: string };

const norm = (s: string) => (s || '').toLowerCase().replace(/ё/g, 'е').replace(/[.\s]/g, '');

const EMPTY_DASHBOARD: DashboardData = {
  globalHealthScore: 0, levelCounts: {}, heatmapData: [],
  xAxisLabels: [], yAxisLabels: [], problematicSystems: [], totalMetrics: 0,
};

interface AnalyticsScopeValue {
  data: DashboardData | null;
  loading: boolean;
  error: string | null;
  isMock: boolean;
  healthPct: number;
  healthColor: string;
  lowTotal: number;
  levelDist: { level: string; count: number; pct: number }[];
  measureLinksCount: number;
  systemsWithSeverity: Array<{ id: string; name: string; criticality: string; lowMetricsCount: number; severity: number }>;
  heatSystem?: string;
  setHeatSystem: (s?: string) => void;
  heat: {
    yLabels: string[];
    matrix: (number | null)[][];
    cellScores?: number[][];
    details: NonNullable<DashboardData['systemDetails']>;
  };
  openDetail: (k: DetailKey) => void;
  openChar: (c: CharModal) => void;
  openSystemLowDetail: (sysName: string) => void;
}

const Ctx = createContext<AnalyticsScopeValue | null>(null);

export function useAnalyticsScope(): AnalyticsScopeValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('Карточка аналитического дашборда отрисована вне AnalyticsScope');
  return v;
}

export const AnalyticsScopeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const dataMode = useSelector((s: RootState) => s.ui.dataMode);
  const proposals = useSelector(selectVisibleProposals, shallowEqual);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isMock, setIsMock] = useState(false);
  const [detail, setDetail] = useState<DetailKey | null>(null);
  const [charDetail, setCharDetail] = useState<CharModal | null>(null);
  const [sysLowDetail, setSysLowDetail] = useState<{ system: string; rows: { characteristic: string; subcharacteristic: string; score: number }[]; breakdown?: SystemScoreBreakdown } | null>(null);
  const [heatSystem, setHeatSystem] = useState<string | undefined>(undefined);
  const { weights: charWeights } = useCharacteristicWeights();
  const navigate = useNavigate();

  useEffect(() => {
    if (dataMode === 'mock') {
      setData(ANALYTICS_SCALE as DashboardData);
      setIsMock(true);
      setError(null);
      setLoading(false);
      return;
    }
    let alive = true;
    const fetchDashboard = async () => {
      setLoading(true);
      setError(null);
      try {
        const token = localStorage.getItem('token');
        const resp = await fetch(`${VITE_API}/assessments/dashboard`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (resp.status === 401) { navigate('/login'); return; }
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const json: DashboardData = await resp.json();
        if (!alive) return;
        setData(json && json.totalMetrics ? json : EMPTY_DASHBOARD);
        setIsMock(false);
      } catch {
        if (!alive) return;
        setError('Backend недоступен — реальных данных нет. Заполните оценки или включите Демо.');
        setData(EMPTY_DASHBOARD);
        setIsMock(false);
      } finally {
        if (alive) setLoading(false);
      }
    };
    fetchDashboard();
    return () => { alive = false; };
  }, [dataMode, navigate]);

  const matrix = useMemo(() => {
    if (!data) return [] as (number | null)[][];
    const m: (number | null)[][] = data.yAxisLabels.map(() => data.xAxisLabels.map(() => null));
    data.heatmapData.forEach(([x, y, v]) => { if (m[y] && x < m[y].length) m[y][x] = v; });
    return m;
  }, [data]);

  const heat = useMemo(() => {
    const details = data?.systemDetails ?? [];
    const yLabels = data?.yAxisLabels ?? [];
    const idx = heatSystem ? yLabels.indexOf(heatSystem) : -1;
    if (heatSystem && idx >= 0) {
      return {
        yLabels: [yLabels[idx]],
        matrix: [matrix[idx]],
        cellScores: details[idx] ? [details[idx].chars.map((c) => c.score)] : undefined,
        details: details[idx] ? [details[idx]] : [],
      };
    }
    return {
      yLabels,
      matrix,
      cellScores: details.length ? details.map((s) => s.chars.map((c) => c.score)) : undefined,
      details,
    };
  }, [data, matrix, heatSystem]);

  // T-54: связка «метрика ↔ мера» по ключу «система|характеристика|метрика», без LLM.
  const measureLinks = useMemo(() => {
    const keyOf = (sys: string, ch: string, m: string) => `${norm(sys)}|${norm(ch)}|${norm(m)}`;
    const countByKey = new Map<string, number>();
    proposals.forEach((p) => {
      const k = keyOf(p.systemName, p.characteristic, p.metricName);
      countByKey.set(k, (countByKey.get(k) ?? 0) + 1);
    });
    const rows: { key: string; system: string; characteristic: string; metric: string; measures: number }[] = [];
    (data?.systemDetails ?? []).forEach((s) => {
      s.chars.forEach((c) => {
        c.subs.forEach((sub) => {
          const k = keyOf(s.name, c.title, sub.name);
          const n = countByKey.get(k);
          if (n) rows.push({ key: `${s.name}|${c.title}|${sub.name}`, system: s.name, characteristic: c.title, metric: sub.name, measures: n });
        });
      });
    });
    return { count: rows.length, rows };
  }, [data, proposals]);

  // ТЗ v20 п.7: ранжирование по ВЕСУ просевших характеристик, не по числу низких метрик.
  const systemsWithSeverity = useMemo(() => {
    const detailsByName = new Map((data?.systemDetails ?? []).map((s) => [s.name, s]));
    return (data?.problematicSystems ?? []).map((sys) => {
      const sd = detailsByName.get(sys.name);
      const severity = (sd?.chars ?? []).reduce(
        (sum, c) => sum + (c.score >= 0 ? (100 - c.score) * (charWeights[c.title] ?? 0) : 0), 0,
      );
      return { ...sys, severity: Math.round(severity) };
    }).sort((a, b) => b.severity - a.severity);
  }, [data, charWeights]);

  const openSystemLowDetail = (sysName: string) => {
    const sd = (data?.systemDetails ?? []).find((s) => s.name === sysName);
    const rows = (sd?.chars ?? []).flatMap((c) => c.subs
      .filter((s) => s.score >= 0 && s.score < 21)
      .map((s) => ({ characteristic: c.title, subcharacteristic: s.name, score: s.score, weight: charWeights[c.title] ?? 0 })))
      .sort((a, b) => b.weight - a.weight)
      .map(({ characteristic, subcharacteristic, score }) => ({ characteristic, subcharacteristic, score }));
    setSysLowDetail({ system: sysName, rows, breakdown: sd?.scoreBreakdown });
  };

  // П.11: в демо globalHealthScore статичен и не реагирует на смену весов — пересчитываем.
  const healthPct = (() => {
    if (!data) return 0;
    if (!isMock || !data.systemDetails?.length) return Math.round(data.globalHealthScore * 100);
    const perSystem = data.systemDetails.map((sd) => {
      const measured = sd.chars.filter((c) => c.score >= 0);
      const w = measured.reduce((a, c) => a + (charWeights[c.title] ?? 0), 0);
      return w > 0
        ? measured.reduce((a, c) => a + c.score * (charWeights[c.title] ?? 0), 0) / w
        : (measured.length ? measured.reduce((a, c) => a + c.score, 0) / measured.length : 0);
    });
    return perSystem.length
      ? Math.round(perSystem.reduce((a, b) => a + b, 0) / perSystem.length)
      : Math.round(data.globalHealthScore * 100);
  })();
  const lowTotal = data?.problematicSystems.reduce((s, p) => s + p.lowMetricsCount, 0) ?? 0;

  const levelDist = data
    ? LEVEL_ORDER
      .map((lvl) => ({ level: lvl, count: data.levelCounts[lvl] ?? 0 }))
      .filter((r) => r.count > 0)
      .map((r) => ({ ...r, pct: data.totalMetrics ? Math.round((r.count / data.totalMetrics) * 100) : 0 }))
    : [];


  const value: AnalyticsScopeValue = {
    data, loading, error, isMock, healthPct, healthColor: ragToken(healthPct).strong, lowTotal,
    levelDist, measureLinksCount: measureLinks.count, systemsWithSeverity,
    heatSystem, setHeatSystem, heat,
    openDetail: setDetail, openChar: setCharDetail, openSystemLowDetail,
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      <Modal open={!!detail} title={detail ? DETAIL_TITLE[detail] : ''} onCancel={() => setDetail(null)} footer={null} width={620}>
        <AnalyticsDetail
          detail={detail}
          data={data}
          healthPct={healthPct}
          lowTotal={lowTotal}
          levelDist={levelDist}
          measureRows={measureLinks.rows}
        />
      </Modal>
      <AnalyticsCharModal charDetail={charDetail} onClose={() => setCharDetail(null)} />
      <AnalyticsSystemLowModal detail={sysLowDetail} onClose={() => setSysLowDetail(null)} />
    </Ctx.Provider>
  );
};

/** Режим данных виден в шапке приложения, отдельного управления у скоупа нет. */
export const AnalyticsScopeToolbar: React.FC = () => null;
