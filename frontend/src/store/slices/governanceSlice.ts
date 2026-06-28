/**
 * governanceSlice.ts — слой «мер качества» (профессиональных суждений / задач).
 * Реализует governance-петлю ТЗ v9 (R2.5 / R3.3):
 *   Менеджер по качеству создаёт меру (PENDING_APPROVAL) →
 *   топ-менеджмент видит её в «Ожидают одобрения» → одобряет/отклоняет.
 *
 * Persist в localStorage, чтобы петля работала без бэкенда. Интерфейс совместим
 * с будущим API: POST /metrics/{id}/judgment, PATCH /governance/proposals/{id}.
 */
import { createSlice, PayloadAction, nanoid } from '@reduxjs/toolkit';
import type { RootState } from '../index';
import { SCALE_PROPOSALS } from '../../data/mockScaleData';

export type ProposalStatus = 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';

export interface Proposal {
  id: string;
  systemName: string;        // ИС, к которой относится мера
  characteristic: string;    // под-характеристика (источник постановки задачи)
  metricName: string;        // метрика
  calculatedScore: number;   // расчётный % на момент суждения
  calculatedLevel: string;   // расчётный уровень
  adjustedLevel?: string;    // ручная корректировка уровня (если есть)
  rationale: string;         // обоснование (профессиональное суждение)
  createRisk: boolean;       // создавать ли карточку риска
  riskTitle?: string;        // наименование риска
  owner?: string;            // ответственный (ФИО)
  ownerRole?: string;        // должность ответственного
  dueDate?: string;          // срок
  /** Что ожидается от ЛПР и почему — для понятности топ-менеджменту (R2.5). */
  expectation: string;
  createdBy: string;
  createdAt: string;
  status: ProposalStatus;
  decidedBy?: string;
  decidedAt?: string;
  /** Комментарий ЛПР при одобрении/отклонении (обоснование решения). */
  decisionComment?: string;
  /** Контроль выполнения одобренной меры менеджером по качеству. */
  execution?: ExecutionStatus;
  executionComment?: string;   // как выполнено / почему не выполнено (обязательно)
  executedBy?: string;
  executedAt?: string;
  /** Демо-мера (засеяна для презентации). В режиме LLM такие меры скрываются. */
  isDemo?: boolean;
}

export type ExecutionStatus = 'DONE' | 'NOT_DONE';

const STORAGE_KEY = 'asok_governance';

function loadProposals(): Proposal[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Proposal[];
  } catch {
    /* битый кэш — пересоздаём из демо-набора */
  }
  // Первый запуск: засеваем масштабный реестр мер (30 ИС) для демонстрации.
  persist(SCALE_PROPOSALS);
  return SCALE_PROPOSALS;
}

function persist(items: Proposal[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    /* quota / private mode — игнорируем, петля деградирует до in-memory */
  }
}

interface GovernanceState {
  proposals: Proposal[];
}

const initialState: GovernanceState = {
  proposals: loadProposals(),
};

export type NewProposalInput = Omit<
  Proposal,
  'id' | 'createdAt' | 'status' | 'decidedBy' | 'decidedAt'
>;

const governanceSlice = createSlice({
  name: 'governance',
  initialState,
  reducers: {
    addProposal: {
      reducer(state, action: PayloadAction<Proposal>) {
        state.proposals.unshift(action.payload);
        persist(state.proposals);
      },
      prepare(input: NewProposalInput) {
        return {
          payload: {
            ...input,
            id: nanoid(),
            createdAt: new Date().toISOString(),
            status: 'PENDING_APPROVAL' as ProposalStatus,
          },
        };
      },
    },
    approveProposal(state, action: PayloadAction<{ id: string; by: string; comment?: string }>) {
      const p = state.proposals.find((x) => x.id === action.payload.id);
      if (p) {
        p.status = 'APPROVED';
        p.decidedBy = action.payload.by;
        p.decidedAt = new Date().toISOString();
        p.decisionComment = action.payload.comment;
        persist(state.proposals);
      }
    },
    rejectProposal(state, action: PayloadAction<{ id: string; by: string; comment?: string }>) {
      const p = state.proposals.find((x) => x.id === action.payload.id);
      if (p) {
        p.status = 'REJECTED';
        p.decidedBy = action.payload.by;
        p.decidedAt = new Date().toISOString();
        p.decisionComment = action.payload.comment;
        persist(state.proposals);
      }
    },
    updateProposalMeta(state, action: PayloadAction<{ id: string; owner?: string; ownerRole?: string; dueDate?: string }>) {
      const p = state.proposals.find((x) => x.id === action.payload.id);
      if (p && p.status === 'PENDING_APPROVAL') {
        if (action.payload.owner !== undefined) p.owner = action.payload.owner;
        if (action.payload.ownerRole !== undefined) p.ownerRole = action.payload.ownerRole;
        if (action.payload.dueDate !== undefined) p.dueDate = action.payload.dueDate;
        persist(state.proposals);
      }
    },
    setExecution(state, action: PayloadAction<{ id: string; status: ExecutionStatus; comment: string; by: string }>) {
      const p = state.proposals.find((x) => x.id === action.payload.id);
      if (p && p.status === 'APPROVED') {
        p.execution = action.payload.status;
        p.executionComment = action.payload.comment;
        p.executedBy = action.payload.by;
        p.executedAt = new Date().toISOString();
        persist(state.proposals);
      }
    },
  },
});

export const { addProposal, approveProposal, rejectProposal, updateProposalMeta, setExecution } = governanceSlice.actions;
export default governanceSlice.reducer;

// --- Селекторы ---
export const selectProposals = (s: RootState) => s.governance.proposals;

/**
 * Видимые меры с учётом режима данных:
 *  - 'mock' (Демо) — все меры, включая засеянные демонстрационные;
 *  - 'live' (LLM)  — только реальные (созданные вручную), демо-меры скрыты.
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
