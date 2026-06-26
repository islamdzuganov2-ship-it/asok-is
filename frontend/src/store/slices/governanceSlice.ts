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
  owner?: string;            // ответственный
  dueDate?: string;          // срок
  /** Что ожидается от ЛПР и почему — для понятности топ-менеджменту (R2.5). */
  expectation: string;
  createdBy: string;
  createdAt: string;
  status: ProposalStatus;
  decidedBy?: string;
  decidedAt?: string;
}

const STORAGE_KEY = 'asok_governance';

function loadProposals(): Proposal[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Proposal[]) : [];
  } catch {
    return [];
  }
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
    approveProposal(state, action: PayloadAction<{ id: string; by: string }>) {
      const p = state.proposals.find((x) => x.id === action.payload.id);
      if (p) {
        p.status = 'APPROVED';
        p.decidedBy = action.payload.by;
        p.decidedAt = new Date().toISOString();
        persist(state.proposals);
      }
    },
    rejectProposal(state, action: PayloadAction<{ id: string; by: string }>) {
      const p = state.proposals.find((x) => x.id === action.payload.id);
      if (p) {
        p.status = 'REJECTED';
        p.decidedBy = action.payload.by;
        p.decidedAt = new Date().toISOString();
        persist(state.proposals);
      }
    },
  },
});

export const { addProposal, approveProposal, rejectProposal } = governanceSlice.actions;
export default governanceSlice.reducer;

// --- Селекторы ---
export const selectProposals = (s: RootState) => s.governance.proposals;
export const selectPendingProposals = (s: RootState) =>
  s.governance.proposals.filter((p) => p.status === 'PENDING_APPROVAL');
export const selectProposalsBySystem = (system: string) => (s: RootState) =>
  s.governance.proposals.filter((p) => p.systemName === system);
