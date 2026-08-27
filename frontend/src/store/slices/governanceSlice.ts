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
import { govApi } from '../api/govApi';

export * from './governanceTypes';
import {
  applyEdit,
  type Clarification, type DueChangeRequest, type EditableProposalFields, type ExecutionStatus,
  type NewProposalInput,
  type Proposal, type ProposalChange, type ProposalStatus,
} from './governanceTypes';

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
const isLive = (s: RootState) => s.ui.dataMode === 'live';

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

/** Исполнитель проставляет трудоёмкость меры в часах вручную (п.13, В-41). */
export const setEffortHours = createAsyncThunk<Proposal | null, { id: string; effortHours: number }, { state: RootState }>(
  'governance/effort',
  async ({ id, effortHours }, { getState }) => {
    if (isLive(getState())) return await govApi(`/proposals/${id}/effort`, 'PATCH', { effortHours });
    const p = getState().governance.proposals.find((x) => x.id === id);
    if (!p || p.status !== 'APPROVED') return null;
    return { ...p, effortHours, effortHoursSetAt: new Date().toISOString() };
  },
);

/** Менеджер по качеству запускает переписывание меры на язык исполнителя (п.16). */
export const rewriteForExecutor = createAsyncThunk<Proposal | null, { id: string }, { state: RootState }>(
  'governance/rewrite-for-executor',
  async ({ id }, { getState }) => {
    if (isLive(getState())) return await govApi(`/proposals/${id}/rewrite-for-executor`, 'POST');
    const p = getState().governance.proposals.find((x) => x.id === id);
    if (!p || p.status !== 'APPROVED') return null;
    return { ...p, executorBrief: `Что сделать: ${p.expectation || p.rationale}. Срок: ${p.dueDate ? `до ${p.dueDate}` : 'не назначен'}.`, executorBriefGeneratedAt: new Date().toISOString() };
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

// ────────── Роль «Исполнитель» (ДЕФ-10 / БТ-015): уточнения + перенос срока ──────────

/** Исполнитель добавляет уточнение по метрике/поручению — попадает менеджеру по качеству. */
export const addClarification = createAsyncThunk<Proposal | null, { id: string; text: string; by: string }, { state: RootState }>(
  'governance/clarification',
  async ({ id, text, by }, { getState }) => {
    if (isLive(getState())) return await govApi(`/proposals/${id}/clarification`, 'POST', { text });
    const p = getState().governance.proposals.find((x) => x.id === id);
    if (!p) return null;
    const note: Clarification = { at: new Date().toISOString(), by, text };
    return { ...p, clarifications: [...(p.clarifications ?? []), note] };
  },
);

/** Исполнитель предлагает новый срок по своему поручению с обоснованием (решает МК). */
export const requestDueChange = createAsyncThunk<Proposal | null, { id: string; proposedDate: string; justification: string; by: string }, { state: RootState }>(
  'governance/due-change',
  async ({ id, proposedDate, justification, by }, { getState }) => {
    if (isLive(getState())) return await govApi(`/proposals/${id}/due-change`, 'POST', { proposedDate, justification });
    const p = getState().governance.proposals.find((x) => x.id === id);
    if (!p) return null;
    const req: DueChangeRequest = { proposedDate, justification, by, at: new Date().toISOString(), status: 'PENDING' };
    return { ...p, dueChangeRequest: req };
  },
);

/** Менеджер по качеству решает по запросу переноса срока: принять (обновит dueDate) или отклонить. */
export const decideDueChange = createAsyncThunk<Proposal | null, { id: string; accept: boolean; by: string; comment?: string }, { state: RootState }>(
  'governance/due-change-decision',
  async ({ id, accept, by, comment }, { getState }) => {
    if (isLive(getState())) return await govApi(`/proposals/${id}/due-change-decision`, 'POST', { accept, comment });
    const p = getState().governance.proposals.find((x) => x.id === id);
    if (!p || !p.dueChangeRequest) return null;
    const req: DueChangeRequest = {
      ...p.dueChangeRequest,
      status: accept ? 'ACCEPTED' : 'DECLINED',
      decidedBy: by,
      decisionComment: comment,
    };
    return { ...p, dueChangeRequest: req, ...(accept ? { dueDate: req.proposedDate } : {}) };
  },
);

// ТЗ v19 §17 (Пункт 17): карточка поручения, критичность, Ц_ОМ — вынесено в отдельный файл
// (governanceCardThunks.ts, потолок размера файла check-size.mjs), реэкспортируется отсюда,
// чтобы публичный контракт слайса для потребителей (компоненты импортируют из governanceSlice) не менялся.
export {
  fetchPriceOfInaction, updateSystemicScope, updateAlternatives, reviewLlmMeasure,
  fetchMeasureDepartments, upsertMeasureDepartment, fetchPriceHistory,
  setActuals, fetchBudgetVariance, fetchEffectTimeline,
} from './governanceCardThunks';
import { updateSystemicScope, updateAlternatives, reviewLlmMeasure, setActuals } from './governanceCardThunks';

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
      setExecution, setEffortHours, rewriteForExecutor, updateTask, escalateTask, decideEscalation,
      resolveEscalation, addClarification, requestDueChange, decideDueChange,
      updateSystemicScope, updateAlternatives, reviewLlmMeasure, setActuals]) {
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

/** Нормализация ФИО для сопоставления исполнителя с ответственным меры (owner). */
const normName = (s?: string) => (s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

/**
 * Поручения, назначенные на исполнителя (ДЕФ-10): меры видимого набора, где owner совпадает с ФИО.
 * Сопоставление нестрогое (регистр/пробелы/ё) — демо-ФИО коротки («Петрова А.С.»).
 */
export const selectProposalsForAssignee = (fullName?: string | null) => (s: RootState): Proposal[] => {
  const target = normName(fullName);
  if (!target) return [];
  const visible = s.ui.dataMode === 'mock' ? s.governance.proposals : s.governance.proposals.filter((p) => !p.isDemo);
  return visible.filter((p) => p.status !== 'REJECTED' && normName(p.owner) === target);
};

/** Для менеджера по качеству: меры с ожидающим запросом переноса срока или новыми уточнениями. */
export const selectAssigneeInbox = (s: RootState): Proposal[] =>
  s.governance.proposals.filter((p) => p.dueChangeRequest?.status === 'PENDING' || (p.clarifications?.length ?? 0) > 0);
