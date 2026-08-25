/**
 * apiTypes.ts — формы ответов бэкенда, которые читает кокпит (ТЗ v21).
 *
 * Один источник вместо дублирования интерфейсов в ceoTiles.tsx/ctoTiles.tsx по отдельности —
 * оба реестра плиток и `apiSlice.getCockpitBundle` используют одни и те же типы.
 */
export interface CostDashboard {
  portfolioAle: number; risksCount: number; nonconformitiesTotal: number; verified: number;
  closureRate: number; blockingCount: number;
  verdict: { eliminate: number; compensate: number; accept: number };
  bySystem: { system: string; ale: number }[];
}

export interface AcceptanceItem {
  id: string; title: string; systemName: string | null; criticality: string | null; ale: number;
  signer: string | null; waitingDays: number; slaDays: number; overdue: boolean; vetoes: string[];
}

export interface AcceptanceQueue {
  items: AcceptanceItem[];
  bySigner: { signer: string; count: number; totalAle: number; overdue: number }[];
  matrixApplied: { maxAle: number | null; signer: string }[];
}

export interface PortfolioRiskSummary {
  totalAtRisk: number; coveredByDoneMeasures: number; residualRisk: number;
  requiredInvestment: number; expectedEffect: number; risksCount: number; measuresCount: number;
}

export interface EffectCurve {
  points: { quarterLabel: string; netCash: number; cumulative: number }[];
  measuresIncluded: number; measuresExcludedNoStartDate: number;
}

export interface OverdueItem {
  proposalId: string; title: string; systemName: string | null; owner: string | null;
  overdueDays: number; priceCurrent: number | null; escalated: boolean;
}

export interface OverdueSummary {
  overdueCount: number; ownersAffected: number; totalPriceCurrent: number; totalPriceSnapshot: number;
  byOwner: { owner: string; count: number; price: number }[]; items: OverdueItem[];
}

export interface PortfolioTrend {
  metric: string; points: { period: string; value: number }[];
  deltaAbsolute: number | null; deltaRelative: number | null; anomaly: boolean; emptyReason: string | null;
}

export interface IncidentAnalytics {
  total: number; openCount: number; resolvedCount: number; avgMttrHours: number | null;
  windowHours: number | null; mtbfHours: number | null; availabilityPct: number | null;
  byCategory: { category: string; count: number; openCount: number; avgMttrHours: number | null }[];
}

export interface TriggeredRisk {
  id: string; code: string; title: string; characteristic?: string | null;
  triggeredBy: string; owner?: string | null;
}

export interface ManagerRow {
  owner: string; openCount: number; overdueCount: number; completedCount: number; deltaAleManaged: number;
}

export interface ManagerMetrics { mode: string; note: string; rows: ManagerRow[] }

export interface CockpitInsightArgs {
  role: 'CEO' | 'CTO';
  facts: Record<string, string>;
  fallback: string;
}

export interface CockpitInsightResult {
  text: string;
  llm: boolean;
}

export interface CockpitBundleArgs {
  role: 'CEO' | 'CTO';
  systemId?: string;
  criticality?: string;
  characteristic?: string;
}

export interface CockpitBundle {
  role: string;
  generatedAt: string;
  costDashboard: CostDashboard | null;
  acceptanceQueue: AcceptanceQueue | null;
  portfolioSummary: PortfolioRiskSummary | null;
  effectCurve: EffectCurve | null;
  overdueSummary: OverdueSummary | null;
  portfolioTrendScore: PortfolioTrend | null;
  incidentAnalytics: IncidentAnalytics | null;
  triggeredRisks: TriggeredRisk[] | null;
  managerMetrics: ManagerMetrics | null;
}
