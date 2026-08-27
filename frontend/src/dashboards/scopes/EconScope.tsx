/**
 * EconScope.tsx — данные «Дашборда стоимости» риск-экономического контура (BL-007).
 *
 * Четыре запроса кормят семь карточек: /econ/dashboard, /risk-events/portfolio-summary,
 * /risk-events/chain, /governance/proposals/effect-curve (+ /econ/manager-metrics для рейтинга
 * руководителей). Держать их в скоупе, а не в карточках, — единственный способ не отправить
 * один и тот же запрос трижды, если пользователь положил рядом три карточки контура.
 *
 * Все расчёты (C_ТС, ALE, ROSI, variance) остаются на бэкенде — здесь только подача.
 */
import React, { createContext, useContext, useEffect, useState } from 'react';

const VITE_API = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api/v1';

export interface TopRisk { code: string; title: string; owner?: string | null; system?: string | null; aleAvg: number; regulatory: boolean }
export interface HeatCell { system: string; subcharacteristic: string; ale: number }
export interface CostDashboard {
  portfolioAle: number; risksCount: number; degradationTotal: number;
  nonconformitiesTotal: number; verified: number; closureRate: number; blockingCount: number;
  verdict: { eliminate: number; compensate: number; accept: number };
  topRisks: TopRisk[]; bySystem: { system: string; ale: number }[]; heatmap: HeatCell[];
}
export interface PortfolioRiskSummary {
  totalAtRisk: number; coveredByDoneMeasures: number; residualRisk: number;
  requiredInvestment: number; expectedEffect: number; risksCount: number; measuresCount: number;
}
export interface RiskMeasureChainMeasure {
  proposalId: string; title: string; status: string; execution: string | null;
  capex: number | null; opexPerYear: number | null; aleReductionShare: number | null;
  deltaAleCash: number | null; deltaAleDeferred: number | null; deltaAleCapacity: number | null;
  rosi: number | null; verdict: string | null; paybackMonths: number | null;
}
export interface RiskMeasureChainRow {
  riskId: string; riskCode: string; riskTitle: string; systemName: string | null;
  aleAvg: number | null; measures: RiskMeasureChainMeasure[];
}
interface QuarterPortfolioPoint { quarterLabel: string; netCash: number; cumulative: number }
export interface PortfolioEffectCurve {
  points: QuarterPortfolioPoint[]; measuresIncluded: number; measuresExcludedNoStartDate: number;
}
export interface ManagerMetricRow {
  owner: string; openCount: number; overdueCount: number; completedCount: number;
  avgAgeDays: number | null; deltaAleManaged: number; acceptShare: number; compensatingShare: number;
  weightedLoad: number; hoursEstimated: number;
  measuresWithEstimate: number; measuresWithoutEstimate: number;
}
export interface ManagerMetrics { mode: string; note: string; generatedAt: string; rows: ManagerMetricRow[] }

function authHeaders(): Record<string, string> {
  const t = localStorage.getItem('token');
  return t ? { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` }
    : { 'Content-Type': 'application/json' };
}
export async function econApi<T>(path: string, opts?: RequestInit): Promise<T> {
  const resp = await fetch(`${VITE_API}${path}`, { headers: authHeaders(), ...opts });
  if (!resp.ok) {
    let detail = '';
    try { detail = (await resp.json()).detail; } catch { /* без тела */ }
    throw new Error(detail || `HTTP ${resp.status}`);
  }
  return (resp.status === 204 ? undefined : await resp.json()) as T;
}

export const fmtMoney = (v?: number | null): string =>
  v === null || v === undefined ? '—' : `${new Intl.NumberFormat('ru-RU').format(Math.round(v))} ₽`;
export const fmtNum = (v?: number | null, digits = 2): string =>
  v === null || v === undefined ? '—' : new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(v);
export const fmtMln = (v: number): string =>
  v >= 1_000_000
    ? `${(v / 1_000_000).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} млн`
    : new Intl.NumberFormat('ru-RU').format(Math.round(v));

interface EconScopeValue {
  d: CostDashboard | null;
  loading: boolean;
  error: string | null;
  summary: PortfolioRiskSummary | null;
  chain: RiskMeasureChainRow[];
  chainLoading: boolean;
  curve: PortfolioEffectCurve | null;
  curveLoading: boolean;
  managers: ManagerMetrics | null;
  managersLoading: boolean;
  managersError: string | null;
}

const Ctx = createContext<EconScopeValue | null>(null);

export function useEconScope(): EconScopeValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('Карточка риск-экономики отрисована вне EconScope');
  return v;
}

export const EconScopeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [d, setD] = useState<CostDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<PortfolioRiskSummary | null>(null);
  const [chain, setChain] = useState<RiskMeasureChainRow[]>([]);
  const [chainLoading, setChainLoading] = useState(true);
  const [curve, setCurve] = useState<PortfolioEffectCurve | null>(null);
  const [curveLoading, setCurveLoading] = useState(true);
  const [managers, setManagers] = useState<ManagerMetrics | null>(null);
  const [managersLoading, setManagersLoading] = useState(true);
  const [managersError, setManagersError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null);
    econApi<CostDashboard>('/econ/dashboard')
      .then((r) => { if (alive) setD(r); })
      .catch((e: any) => { if (alive) setError(e.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    setChainLoading(true);
    Promise.all([
      econApi<PortfolioRiskSummary>('/risk-events/portfolio-summary'),
      econApi<RiskMeasureChainRow[]>('/risk-events/chain'),
    ])
      .then(([s, c]) => { if (alive) { setSummary(s); setChain(c); } })
      .catch(() => { if (alive) { setSummary(null); setChain([]); } })
      .finally(() => { if (alive) setChainLoading(false); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    setCurveLoading(true);
    econApi<PortfolioEffectCurve>('/governance/proposals/effect-curve')
      .then((r) => { if (alive) setCurve(r); })
      .catch(() => { if (alive) setCurve(null); })
      .finally(() => { if (alive) setCurveLoading(false); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    setManagersLoading(true); setManagersError(null);
    econApi<ManagerMetrics>('/econ/manager-metrics')
      .then((r) => { if (alive) setManagers(r); })
      .catch((e: any) => { if (alive) setManagersError(e.message); })
      .finally(() => { if (alive) setManagersLoading(false); });
    return () => { alive = false; };
  }, []);

  return (
    <Ctx.Provider value={{
      d, loading, error, summary, chain, chainLoading, curve, curveLoading,
      managers, managersLoading, managersError,
    }}>
      {children}
    </Ctx.Provider>
  );
};

export const EconScopeToolbar: React.FC = () => null;
