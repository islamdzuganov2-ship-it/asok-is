/**
 * governanceSlice.ts — слой «мер качества» (профессиональных суждений / задач).
 * Governance-петля ТЗ v9/v12: менеджер по качеству создаёт меру → топ-менеджмент одобряет/
 * отклоняет → менеджер ведёт исполнение/эскалацию → топ-менеджмент решает по эскалации.
 *
 * ИСТОЧНИК ДАННЫХ по режиму (T-10, код-ревью 2026-07-06):
 *  - 'live' (LLM/реальные данные) — БД через API `/governance/proposals` (СИНХРОНИЗАЦИЯ между
 *    ролями и устройствами: SoD и решения на бэкенде, ролевая модель v12);
 *  - 'mock' (Демо) — фронтовые демо-меры в localStorage (презентация без бэкенда).
 * Интерфейс слайса (экшены-thunks с прежними сигнатурами + селекторы) сохранён — компоненты
 * не переписываются; в live thunk шлёт в API, в mock — обновляет локально.
 */
import { createSlice, createAsyncThunk, PayloadAction, nanoid } from '@reduxjs/toolkit';
import type { RootState } from '../index';
import { SCALE_PROPOSALS } from '../../data/mockScaleData';

export type ProposalStatus = 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';

export interface Proposal {
  id: string;
  systemName: string;
  characteristic: string;
  metricName: string;
  calculatedScore: number;
  calculatedLevel: string;
  adjustedLevel?: string;
  rationale: string;
  createRisk: boolean;
  riskTitle?: string;
  owner?: string;
  ownerRole?: string;
  dueDate?: string;
  /** Что ожидается от ЛПР и почему — для понятности топ-менеджменту (R2.5). */
  expectation: string;
  createdBy: string;
  createdAt: string;
  status: ProposalStatus;
  decidedBy?: string;
  decidedAt?: string;
  decisionComment?: string;
  execution?: ExecutionStatus;
  executionComment?: string;
  executedBy?: string;
  executedAt?: string;
  /** Демо-мера (засеяна для презентации). В режиме LLM такие меры скрываются. */
  isDemo?: boolean;
  /** История правок меры (аудит): кто, когда, какое поле, старое → новое значение. */
  history?: ProposalChange[];
  suzLink?: string;
  topComment?: string;
  escalated?: boolean;
  escalationReason?: string;
  escalationDecision?: 'IGNORE' | 'REQUEST_MEASURES';
  escalationDecisionComment?: string;
  escalationDecidedBy?: string;
}

export type ExecutionStatus = 'DONE' | 'NOT_DONE';

/** Запись аудита правок меры. */
export interface ProposalChange {
  at: string;
  by: string;
  field: string;
  from?: string;
  to?: string;
}

/** Поля меры, доступные для правки топ-менеджером (пишутся в аудит). */
export type EditableProposalFields = Pick<
  Proposal, 'riskTitle' | 'rationale' | 'expectation' | 'owner' | 'ownerRole' | 'dueDate' | 'topComment'
>;

// --- Локальный кэш демо-режима (mock) ---
const STORAGE_KEY = 'asok_governance_v2';
const OLD_KEYS = ['asok_governance'];

function loadProposals(): Proposal[] {
  try {
    OLD_KEYS.forEach((k) => localStorage.removeItem(k));
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Proposal[];
  } catch {
    /* битый кэш — пересоздаём из демо-набора */
  }
  persist(SCALE_PROPOSALS);
  return SCALE_PROPOSALS;
}

function persist(items: Proposal[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    /* quota / private mode — деградируем до in-memory */
  }
}

// --- API governance (live-режим) ---
const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v1';

async function govApi(path: string, method: string, body?: unknown): Promise<any> {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE}/governance${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`governance ${method} ${path} → ${res.status}`);
  return res.json();
}

const isLive = (s: RootState) => s.ui.dataMode === 'live';

export type NewProposalInput = Omit<
  Proposal,
  'id' | 'createdAt' | 'status' | 'decidedBy' | 'decidedAt'
>;

/**
 * Чистое вычисление правки меры для mock-режима (тестируемо, используется thunk editProposal):
 * применяет изменённые поля и дописывает каждое в историю (кто, когда, было → стало). Возвращает
 * обновлённую меру либо null, если изменений нет. В live этим занимается бэкенд.
 */
export function applyEdit(p: Proposal, patch: Partial<EditableProposalFields>, by: string): Proposal | null {
  const at = new Date().toISOString();
  const changes: ProposalChange[] = [];
  const next: any = { ...p };
  (Object.keys(patch) as Array<keyof EditableProposalFields>).forEach((field) => {
    const value = patch[field];
    if (value === undefined) return;
    const prev = (p[field] ?? '') as string;
    if (String(value) === String(prev)) return;
    changes.push({ at, by, field, from: prev || undefined, to: String(value) || undefined });
    next[field] = value;
  });
  if (!changes.length) return null;
  next.history = [...(p.history ?? []), ...changes];
  return next as Proposal;
}

// ─────────────────────────── Thunks (live: API · mock: локально) ───────────────────────────

/** Загрузка мер: live — из БД; mock — оставить текущий локальный набор (возврат null). */
export const syncProposals = createAsyncThunk<Proposal[] | null, void, { state: RootState }>(
  'governance/sync',
  async (_, { getState }) => (isLive(getState()) ? await govApi('/proposals', 'GET') : null),
);

export const addProposal = createAsyncThunk<Proposal, NewProposalInput, { state: RootState }>(
  'governance/add',
  async (input, { getState }) => {
    if (isLive(getState())) {
      return await govApi('/proposals', 'POST', input);
    }
    return {
      ...input,
      id: nanoid(),
      createdAt: new Date().toISOString(),
      status: 'PENDING_APPROVAL' as ProposalStatus,
    };
  },
);

type DecideArg = { id: string; by: string; comment?: string };

export const approveProposal = createAsyncThunk<Proposal | null, DecideArg, { state: RootState }>(
  'governance/approve',
  async ({ id, by, comment }, { getState }) => {
    if (isLive(getState())) return await govApi(`/proposals/${id}/approve`, 'POST', { comment });
    const p = getState().governance.proposals.find((x) => x.id === id);
    if (!p) return null;
    return { ...p, status: 'APPROVED', decidedBy: by, decidedAt: new Date().toISOString(), decisionComment: comment };
  },
);

export const rejectProposal = createAsyncThunk<Proposal | null, DecideArg, { state: RootState }>(
  'governance/reject',
  async ({ id, by, comment }, { getState }) => {
    if (isLive(getState())) return await govApi(`/proposals/${id}/reject`, 'POST', { comment });
    const p = getState().governance.proposals.find((x) => x.id === id);
    if (!p) return null;
    return { ...p, status: 'REJECTED', decidedBy: by, decidedAt: new Date().toISOString(), decisionComment: comment };
  },
);

type MetaArg = { id: string; owner?: string; ownerRole?: string; dueDate?: string };

export const updateProposalMeta = createAsyncThunk<Proposal | null, MetaArg, { state: RootState }>(
  'governance/meta',
  async ({ id, owner, ownerRole, dueDate }, { getState }) => {
    if (isLive(getState())) return await govApi(`/proposals/${id}/meta`, 'PATCH', { owner, ownerRole, dueDate });
    const p = getState().governance.proposals.find((x) => x.id === id);
    if (!p || p.status !== 'PENDING_APPROVAL') return null;
    return {
      ...p,
      ...(owner !== undefined ? { owner } : {}),
      ...(ownerRole !== undefined ? { ownerRole } : {}),
      ...(dueDate !== undefined ? { dueDate } : {}),
    };
  },
);

type EditArg = { id: string; by: string; patch: Partial<EditableProposalFields> };

export const editProposal = createAsyncThunk<Proposal | null, EditArg, { state: RootState }>(
  'governance/edit',
  async ({ id, by, patch }, { getState }) => {
    if (isLive(getState())) return await govApi(`/proposals/${id}`, 'PATCH', patch);
    const p = getState().governance.proposals.find((x) => x.id === id);
    if (!p) return null;
    return applyEdit(p, patch, by);
  },
);

type ExecArg = { id: string; status: ExecutionStatus; comment: string; by: string };

export const setExecution = createAsyncThunk<Proposal | null, ExecArg, { state: RootState }>(
  'governance/execution',
  async ({ id, status, comment, by }, { getState }) => {
    if (isLive(getState())) return await govApi(`/proposals/${id}/execution`, 'POST', { status, comment });
    const p = getState().governance.proposals.find((x) => x.id === id);
    if (!p || p.status !== 'APPROVED') return null;
    return { ...p, execution: status, executionComment: comment, executedBy: by, executedAt: new Date().toISOString() };
  },
);

type TaskArg = { id: string; suzLink?: string; topComment?: string; escalated?: boolean; owner?: string; ownerRole?: string; dueDate?: string };

export const updateTask = createAsyncThunk<Proposal | null, TaskArg, { state: RootState }>(
  'governance/task',
  async (arg, { getState }) => {
    const { id, escalated, ...rest } = arg;
    if (isLive(getState())) return await govApi(`/proposals/${id}/task`, 'PATCH', rest);
    const p = getState().governance.proposals.find((x) => x.id === id);
    if (!p) return null;
    const next: any = { ...p };
    (Object.keys(arg) as Array<keyof TaskArg>).forEach((k) => {
      if (k !== 'id' && arg[k] !== undefined) next[k] = arg[k];
    });
    return next as Proposal;
  },
);

type EscalateArg = { id: string; reason: string; by: string };

export const escalateTask = createAsyncThunk<Proposal | null, EscalateArg, { state: RootState }>(
  'governance/escalate',
  async ({ id, reason }, { getState }) => {
    if (isLive(getState())) return await govApi(`/proposals/${id}/escalate`, 'POST', { reason });
    const p = getState().governance.proposals.find((x) => x.id === id);
    if (!p) return null;
    return { ...p, escalated: true, escalationReason: reason, escalationDecision: undefined, escalationDecisionComment: undefined, escalationDecidedBy: undefined };
  },
);

type EscalationDecisionArg = { id: string; decision: 'IGNORE' | 'REQUEST_MEASURES'; comment: string; by: string };

export const decideEscalation = createAsyncThunk<Proposal | null, EscalationDecisionArg, { state: RootState }>(
  'governance/escalation-decision',
  async ({ id, decision, comment, by }, { getState }) => {
    if (isLive(getState())) return await govApi(`/proposals/${id}/escalation-decision`, 'POST', { decision, comment });
    const p = getState().governance.proposals.find((x) => x.id === id);
    if (!p || !p.escalated) return null;
    return { ...p, escalationDecision: decision, escalationDecisionComment: comment, escalationDecidedBy: by };
  },
);

export const resolveEscalation = createAsyncThunk<Proposal | null, { id: string }, { state: RootState }>(
  'governance/resolve-escalation',
  async ({ id }, { getState }) => {
    if (isLive(getState())) return await govApi(`/proposals/${id}/resolve-escalation`, 'POST');
    const p = getState().governance.proposals.find((x) => x.id === id);
    if (!p) return null;
    return { ...p, escalated: false };
  },
);

// ─────────────────────────────────── Slice ───────────────────────────────────
interface GovernanceState {
  proposals: Proposal[];
  loading: boolean;
}

const initialState: GovernanceState = {
  proposals: loadProposals(),
  loading: false,
};

function upsert(state: GovernanceState, p: Proposal) {
  const i = state.proposals.findIndex((x) => x.id === p.id);
  if (i >= 0) state.proposals[i] = p;
  else state.proposals.unshift(p);
}

const governanceSlice = createSlice({
  name: 'governance',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(syncProposals.pending, (state) => { state.loading = true; })
      .addCase(syncProposals.fulfilled, (state, action: PayloadAction<Proposal[] | null>) => {
        state.loading = false;
        if (action.payload) state.proposals = action.payload;  // live: заменяем набором из БД
      })
      .addCase(syncProposals.rejected, (state) => { state.loading = false; })
      .addCase(addProposal.fulfilled, (state, action) => {
        state.proposals.unshift(action.payload);
        persist(state.proposals);
      });
    // Мутации возвращают обновлённую меру (или null, если действие не применилось в mock).
    for (const thunk of [approveProposal, rejectProposal, updateProposalMeta, editProposal,
      setExecution, updateTask, escalateTask, decideEscalation, resolveEscalation]) {
      builder.addCase(thunk.fulfilled, (state, action: PayloadAction<Proposal | null>) => {
        if (action.payload) {
          upsert(state, action.payload);
          persist(state.proposals);
        }
      });
    }
  },
});

export default governanceSlice.reducer;

// --- Селекторы (интерфейс сохранён) ---
export const selectProposals = (s: RootState) => s.governance.proposals;

/**
 * Видимые меры с учётом режима данных:
 *  - 'mock' (Демо) — все меры, включая засеянные демонстрационные;
 *  - 'live' (LLM)  — только реальные (из БД); демо-признак isDemo скрывается.
 * Использовать с shallowEqual в useSelector (ссылки элементов сохраняются).
 */
export const selectVisibleProposals = (s: RootState): Proposal[] =>
  s.ui.dataMode === 'mock'
    ? s.governance.proposals
    : s.governance.proposals.filter((p) => !p.isDemo);

export const selectPendingProposals = (s: RootState) =>
  s.governance.proposals.filter((p) => p.status === 'PENDING_APPROVAL');
export const selectProposalsBySystem = (system: string) => (s: RootState) =>
  s.governance.proposals.filter((p) => p.systemName === system);
