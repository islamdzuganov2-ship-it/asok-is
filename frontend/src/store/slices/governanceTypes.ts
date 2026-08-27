/**
 * governanceTypes.ts — контракт «меры качества»: формы данных и правило безопасной правки.
 *
 * Вынесено из governanceSlice: описаний данных накопилось больше, чем самой логики слайса, и
 * нужны они сами по себе — карточке меры, плану задач, разделу «Мои задачи». Здесь нет ни
 * обращений к API, ни к стору: только типы и чистая applyEdit, поэтому модуль дёшево
 * импортировать откуда угодно и легко тестировать.
 */
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
  /** ТЗ v19 УК-36: реальный тип даты (ISO), источник истины для сортировки/сравнения — `dueDate`
   * остаётся строкой для обратной совместимости и ручного ввода, но не пересчитывается из dueOn. */
  dueOn?: string;
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
  // ТЗ v19 п.13 (В-41): трудоёмкость в часах — проставляет исполнитель вручную. undefined ≠ 0 —
  // «нет оценки» отличается от «оценена в 0 часов» (см. AssigneeTasksPage, ManagersTab).
  effortHours?: number;
  effortHoursSetBy?: string;
  effortHoursSetAt?: string;
  // ТЗ v19 п.16: мера, переписанная на язык исполнителя (персона EXECUTOR) — появляется в
  // «Плане задач» (внутренний Гант) и на «Моих задачах» после того, как менеджер по качеству
  // нажмёт «Переписать для исполнителя».
  executorBrief?: string;
  executorBriefGeneratedBy?: string;
  executorBriefGeneratedAt?: string;
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
  // ДЕФ-10 (БТ-015, роль «Исполнитель»): уточнения исполнителя по метрике/поручению и запрос
  // на перенос срока с обоснованием. Всё это «падает» менеджеру по качеству — он решает.
  clarifications?: Clarification[];
  dueChangeRequest?: DueChangeRequest;
  // ТЗ v19 п.7/11: экономический слой меры (BL-007 RE-11/12) — уже считает бэкенд
  // (governance/schemas.py ProposalOut), но фронт эти поля не объявлял и не показывал.
  measureType?: 'ELIMINATING' | 'COMPENSATING';
  capex?: number;
  opexPerYear?: number;
  implementationMonths?: number;
  expectedDeltaScore?: number;
  deltaAleCash?: number;
  deltaAleDeferred?: number;
  deltaAleCapacity?: number;
  rosi?: number;
  recommendedVerdict?: 'ELIMINATE' | 'COMPENSATE' | 'ACCEPT';
  verdict?: 'ELIMINATE' | 'COMPENSATE' | 'ACCEPT';
  // ТЗ v19 §17: карточка поручения, критичность, Ц_ОМ (governance/schemas.py ProposalOut).
  isProcessMeasure?: boolean;
  isBlockingOverride?: boolean;
  aleAtRiskSnapshot?: number;
  aleAtRiskSnapshotAt?: string;
  aleAtRiskCurrent?: number;
  aleAtRiskCurrentAt?: string;
  alternativeSolutions?: AlternativeSolution[];
  systemicScopeNote?: string;
  systemicScopeLlmNote?: string;
  systemicScopeSystemCount?: number;
  department?: string;
  measureSource?: 'MANUAL' | 'CATALOG' | 'LLM';
  llmReviewedBy?: string;
  llmReviewedAt?: string;
  // §17.5 (УК-52/53): транзиентные поля очереди — заполнены, только когда список запрошен
  // с order_by=priority (по умолчанию в live-режиме).
  priorityWeight?: number;
  priorityMoney?: number;
  priorityIsAtypical?: boolean;
  // §17.7 (УК-57): факт по бюджету/трудоёмкости — рядом с планом (capex/opexPerYear/effortHours).
  actualCapex?: number;
  actualOpex?: number;
  actualEffortHours?: number;
  actualsSetBy?: string;
  actualsSetAt?: string;
}

/** План/факт по мере (§17.7) — variance = факт − план, undefined при отсутствии любой стороны. */
export interface BudgetVariance {
  proposalId: string;
  plannedCapex?: number;
  actualCapex?: number;
  capexVariance?: number;
  plannedOpex?: number;
  actualOpex?: number;
  opexVariance?: number;
  plannedEffortHours?: number;
  actualEffortHours?: number;
  effortVariance?: number;
}

/** ТЗ v19 п.15 (УК-37) — эффект меры во времени, по кварталам. */
export interface QuarterEffectPoint {
  quarterLabel: string;
  quarterStart: string;
  netCash: number;
  cumulative: number;
}
export interface EffectTimeline {
  proposalId: string;
  computable: boolean;
  reason?: string;
  startDate?: string;
  effectStartDate?: string;
  capex: number;
  points: QuarterEffectPoint[];
  paybackQuarter?: string;
}

/** Альтернативный вариант решения на карточке эскалации (§17.3). */
export interface AlternativeSolution {
  title: string;
  capex?: number;
  opex?: number;
  note?: string;
}

/** Ц_ОМ — цена неисполнения меры на карточке (§17.4). */
export interface PriceOfInaction {
  proposalId: string;
  measureType?: 'ELIMINATING' | 'COMPENSATING';
  isOverdue: boolean;
  aleRisk: number;
  priceSnapshot?: number;
  priceSnapshotAt?: string;
  priceCurrent?: number;
  priceCurrentAt?: string;
}

/** Дневная точка Ц_ОМ и агрегация за период (§17.4, УК-51). */
export interface PriceHistoryPoint {
  date: string;
  price: number;
}

export interface PriceHistory {
  proposalId: string;
  period: 'day' | 'quarter';
  periodStart: string;
  periodEnd: string;
  points: PriceHistoryPoint[];
  periodAvg?: number;
}

/** Справочник направлений (§17.3, УК-47) — временный, характеристика → направление. */
export interface MeasureDepartment {
  id: string;
  characteristic: string;
  departmentName: string;
  updatedBy?: string;
}

/** Уточнение исполнителя по метрике/поручению (видит менеджер по качеству). */
export interface Clarification {
  at: string;
  by: string;
  text: string;
}

/** Запрос исполнителя на перенос срока поручения с обоснованием (решает менеджер по качеству). */
export interface DueChangeRequest {
  proposedDate: string;   // предложенный новый срок (ДД.ММ.ГГГГ)
  justification: string;  // обоснование
  by: string;             // исполнитель
  at: string;
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED';
  decidedBy?: string;
  decisionComment?: string;
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

