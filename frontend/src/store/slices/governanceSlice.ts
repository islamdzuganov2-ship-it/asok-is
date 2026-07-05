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
  /** История правок меры (аудит): кто, когда, какое поле, старое → новое значение. */
  history?: ProposalChange[];
  /** План задач по повышению качества: */
  suzLink?: string;       // ссылка на задачу в СУЗ (система управления знаниями/задачами)
  topComment?: string;    // комментарий топ-менеджера к задаче (по клику)
  escalated?: boolean;    // эскалирована менеджером по качеству (срыв срока / невыполнение)
  escalationReason?: string;   // причина невыполнения/просрочки — пишет QM при эскалации
  escalationDecision?: 'IGNORE' | 'REQUEST_MEASURES'; // решение топ-менеджмента по эскалации
  escalationDecisionComment?: string;                  // указание/комментарий топ-менеджмента
  escalationDecidedBy?: string;
}

export type ExecutionStatus = 'DONE' | 'NOT_DONE';

/** Запись аудита правок меры. */
export interface ProposalChange {
  at: string;      // ISO-время правки
  by: string;      // кто внёс правку (ФИО/роль)
  field: string;   // ключ поля Proposal
  from?: string;   // старое значение
  to?: string;     // новое значение
}

/** Поля меры, доступные для правки топ-менеджером (пишутся в аудит). */
export type EditableProposalFields = Pick<
  Proposal, 'riskTitle' | 'rationale' | 'expectation' | 'owner' | 'ownerRole' | 'dueDate' | 'topComment'
>;

// v2: пересеяны демо-данные с ролевым подходом (ответственные по характеристикам,
// эскалации по критичности); старый ключ удаляется, чтобы не тянуть прежние моки.
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
    // Правка меры топ-менеджером: каждое изменённое поле пишется в историю правок (аудит).
    editProposal(state, action: PayloadAction<{ id: string; by: string; patch: Partial<EditableProposalFields> }>) {
      const p = state.proposals.find((x) => x.id === action.payload.id);
      if (!p) return;
      const { by, patch } = action.payload;
      const at = new Date().toISOString();
      const changes: ProposalChange[] = [];
      (Object.keys(patch) as Array<keyof EditableProposalFields>).forEach((field) => {
        const next = patch[field];
        if (next === undefined) return;
        const prev = (p[field] ?? '') as string;
        if (String(next) === String(prev)) return;
        changes.push({ at, by, field, from: prev || undefined, to: String(next) || undefined });
        (p as any)[field] = next;
      });
      if (changes.length) {
        p.history = [...(p.history ?? []), ...changes];
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
    // План задач по повышению качества: правки СУЗ-ссылки, комментария топ-менеджера, эскалации,
    // ответственного/срока. Управляет менеджер по качеству; комментарий/эскалация — топ-менеджмент.
    updateTask(state, action: PayloadAction<{
      id: string; suzLink?: string; topComment?: string; escalated?: boolean; owner?: string; ownerRole?: string; dueDate?: string;
    }>) {
      const p = state.proposals.find((x) => x.id === action.payload.id);
      if (p) {
        const { id, ...rest } = action.payload;
        (Object.keys(rest) as Array<keyof typeof rest>).forEach((k) => {
          if (rest[k] !== undefined) (p as any)[k] = rest[k];
        });
        persist(state.proposals);
      }
    },
    // Эскалацию инициирует ТОЛЬКО менеджер по качеству, обязательно с причиной невыполнения/просрочки.
    escalateTask(state, action: PayloadAction<{ id: string; reason: string; by: string }>) {
      const p = state.proposals.find((x) => x.id === action.payload.id);
      if (p) {
        p.escalated = true;
        p.escalationReason = action.payload.reason;
        p.escalationDecision = undefined;
        p.escalationDecisionComment = undefined;
        p.escalationDecidedBy = undefined;
        persist(state.proposals);
      }
    },
    // Решение по эскалации принимает ТОЛЬКО топ-менеджмент: игнорировать / запросить доп. меры.
    decideEscalation(state, action: PayloadAction<{ id: string; decision: 'IGNORE' | 'REQUEST_MEASURES'; comment: string; by: string }>) {
      const p = state.proposals.find((x) => x.id === action.payload.id);
      if (p && p.escalated) {
        p.escalationDecision = action.payload.decision;
        p.escalationDecisionComment = action.payload.comment;
        p.escalationDecidedBy = action.payload.by;
        persist(state.proposals);
      }
    },
    // «Отработано» менеджером по качеству — цикл эскалации закрыт (решение сохраняется в истории).
    resolveEscalation(state, action: PayloadAction<{ id: string }>) {
      const p = state.proposals.find((x) => x.id === action.payload.id);
      if (p) { p.escalated = false; persist(state.proposals); }
    },
  },
});

export const {
  addProposal, approveProposal, rejectProposal, editProposal, updateProposalMeta, setExecution, updateTask,
  escalateTask, decideEscalation, resolveEscalation,
} = governanceSlice.actions;
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
