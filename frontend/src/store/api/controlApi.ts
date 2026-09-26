/**
 * controlApi.ts — эндпоинты управленческого контура ТЗ-19, подмешанные в общий apiSlice.
 *
 * Отдельный модуль (injectEndpoints), а не правка apiSlice: тот упёрся в потолок размера
 * (check-size.mjs), а новые экраны — самостоятельные: нагрузка и балансировка исполнителей
 * (УК-32/33), сверка исполнения со сбоями (УК-45), очередь бюджетных заявок (УК-54), типовые
 * ставки и отклонения (УК-25/26), журнал уведомлений (УК-15), «В работу» (УК-38).
 */
import { apiSlice } from './apiSlice';

export interface LoadMeasure {
  proposalId: string; title: string; system: string; characteristic: string | null;
  criticality: string | null; hours: number | null; weight: number | null;
  weightExplained: string; overdue: boolean; dueOn: string | null;
}
export interface ExecutorLoadRow {
  owner: string; openMeasures: number; hours: number; weightedLoad: number; withoutEstimate: number;
  overdue: number; onCriticalSystems: number; normHours: number; loadPct: number;
  state: 'overloaded' | 'normal' | 'free'; measures: LoadMeasure[];
}
export interface RebalanceHint { proposalId: string; title: string; fromOwner: string; toOwner: string; hours: number; reason: string }
export interface ExecutorLoad { normHours: number; sizeClass: string | null; rows: ExecutorLoadRow[]; hints: RebalanceHint[]; note: string }
export interface OverloadCheck { owner: string; hoursBefore: number; hoursAfter: number; normHours: number; overloaded: boolean; message: string | null }

export interface MismatchIncident { id: string; title: string; occurredAt: string; costTotal: number | null; similarity: number | null }
export interface ExecutionMismatch {
  proposalId: string; title: string; system: string; owner: string | null; executedAt: string | null;
  kind: 'linked' | 'similar'; incidents: MismatchIncident[]; note: string;
}

export interface BudgetQueueRow {
  rank: number; proposalId: string; title: string; systemName: string; characteristic: string | null;
  status: string; capex: number; opexPerYear: number | null; rosi: number | null;
  characteristicWeight: number; moneyAtRisk: number; overdue: boolean; priorityKey: number;
  explained: string; cumulativeCapex: number; withinBudget: boolean | null; isAtypical: boolean;
}
export interface BudgetQueue { budget: number | null; totalCapex: number; rows: BudgetQueueRow[]; note: string }

export interface RateDeviation {
  rateId: string; systemId: string | null; line: string; executorType: string; vendor: string | null;
  ratePerHour: number; typicalRate: number | null; typicalSource: string | null;
  typicalObservedOn: string | null; deviationPct: number | null; note: string;
}
export interface RateDeviations { thresholdPct: number; sizeClass: string | null; rows: RateDeviation[]; withoutReference: number }
export interface FillDefaultsResult { created: number; updated: number; skippedNoReference: string[] }

export interface NotificationDelivery {
  id: string; eventType: string; recipient: string; address: string | null; channel: string;
  subject: string; body: string; entityType: string; entityId: string; hasAttachments: boolean;
  status: 'SENT' | 'FAILED' | 'UNDELIVERABLE'; reason: string | null; attempts: number;
  createdAt: string; sentAt: string | null;
}
export interface UndeliverableRow { recipient: string; reason: string | null; events: number; lastAt: string | null }

export const controlApi = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getExecutorLoad: builder.query<ExecutorLoad, void>({ query: () => '/governance/executor-load' }),
    checkExecutorLoad: builder.query<OverloadCheck, { owner: string; hours?: number | null; proposalId?: string }>({
      query: ({ owner, hours, proposalId }) => ({
        url: '/governance/executor-load/check',
        params: { owner, ...(hours ? { hours } : {}), ...(proposalId ? { proposal_id: proposalId } : {}) },
      }),
    }),
    previewExecutorBrief: builder.query<{ text: string }, string>({
      query: (id) => `/governance/proposals/${id}/executor-brief-preview`,
    }),
    getExecutionMismatches: builder.query<ExecutionMismatch[], void>({ query: () => '/risk-events/execution-mismatches' }),
    getBudgetQueue: builder.query<BudgetQueue, number | null>({
      query: (budget) => ({ url: '/governance/budget-queue', params: budget ? { budget } : {} }),
    }),
    getRateDeviations: builder.query<RateDeviations, number | null>({
      query: (threshold) => ({ url: '/econ/rates/deviations', params: threshold ? { threshold_pct: threshold } : {} }),
    }),
    fillDefaultRates: builder.mutation<FillDefaultsResult, { systemId?: string | null; executorType?: string; refresh?: boolean }>({
      query: (body) => ({ url: '/econ/rates/fill-defaults', method: 'POST', body }),
    }),
    confirmRate: builder.mutation<unknown, string>({
      query: (id) => ({ url: `/econ/rates/${id}/confirm`, method: 'POST' }),
    }),
    getNotificationLog: builder.query<NotificationDelivery[], { status?: string }>({
      query: ({ status }) => ({ url: '/notifications/log', params: status ? { status } : {} }),
    }),
    getUndeliverable: builder.query<UndeliverableRow[], void>({ query: () => '/notifications/undeliverable' }),
    retryNotifications: builder.mutation<{ delivered: number }, void>({
      query: () => ({ url: '/notifications/retry', method: 'POST' }),
    }),
  }),
});

export const {
  useGetExecutorLoadQuery,
  useLazyCheckExecutorLoadQuery,
  useLazyPreviewExecutorBriefQuery,
  useGetExecutionMismatchesQuery,
  useGetBudgetQueueQuery,
  useGetRateDeviationsQuery,
  useFillDefaultRatesMutation,
  useConfirmRateMutation,
  useGetNotificationLogQuery,
  useGetUndeliverableQuery,
  useRetryNotificationsMutation,
} = controlApi;
