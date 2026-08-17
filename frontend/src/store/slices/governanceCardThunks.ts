/**
 * governanceCardThunks.ts — ТЗ v19 §17 (Пункт 17): карточка поручения, критичность, Ц_ОМ.
 *
 * Вынесено из governanceSlice.ts (превышало потолок check-size.mjs) — те же thunks, тот же
 * live/mock контракт (govApi/isLive), просто в отдельном файле. Реэкспортируются через
 * governanceSlice.ts, чтобы extraReducers мог их зарегистрировать (потребители импортируют
 * оттуда же, как и раньше — публичный контракт слайса не меняется).
 */
import { createAsyncThunk } from '@reduxjs/toolkit';
import type { RootState } from '../index';
import { govApi } from '../api/govApi';
import type { AlternativeSolution, MeasureDepartment, PriceOfInaction, Proposal } from './governanceSlice';

const isLive = (s: RootState) => s.ui.dataMode === 'live';

/** Разбор даты формата ДД.ММ.ГГГГ (тот же формат, что AssigneeTasksPage.tsx/TaskPlanDashboard.tsx). */
function parseRuDate(d?: string): number | null {
  if (!d) return null;
  const m = /(\d{2})\.(\d{2})\.(\d{4})/.exec(d);
  return m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])).getTime() : null;
}

// «Текущая дата системы» демо-сценария (26.06.2026) — та же константа, что в AssigneeTasksPage.tsx/
// EmployeeEffectivenessCard.tsx/MeasuresRegistryCard.tsx/TechDebtCard.tsx. Реальный `Date.now()`
// здесь дал бы «просрочено» для мер с датами демо-сценария, давно прошедшими по календарю, но
// «текущими» по внутренней логике демо — расхождение со статусами, которые показывает остальная
// страница (см. verification: СЭД 31.07.2026 ошибочно считался просроченным против Date.now()).
const MOCK_TODAY = new Date(2026, 5, 26).getTime();

/** Ц_ОМ на карточке (§17.4) — не хранится в Redux (транзиентное значение просмотра),
 * читается по требованию через `.unwrap()` при открытии карточки. */
export const fetchPriceOfInaction = createAsyncThunk<PriceOfInaction | null, { id: string }, { state: RootState }>(
  'governance/price-of-inaction',
  async ({ id }, { getState }) => {
    if (isLive(getState())) return await govApi(`/proposals/${id}/price-of-inaction`, 'GET');
    const p = getState().governance.proposals.find((x) => x.id === id);
    if (!p) return null;
    const overdueMs = parseRuDate(p.dueDate);
    const isOverdue = p.execution !== 'DONE' && overdueMs !== null && overdueMs < MOCK_TODAY;
    const aleRisk = p.deltaAleCash ?? 0;
    return {
      proposalId: p.id, measureType: p.measureType, isOverdue, aleRisk,
      priceSnapshot: isOverdue ? aleRisk : undefined,
      priceCurrent: isOverdue ? aleRisk : undefined,
      priceCurrentAt: isOverdue ? new Date(MOCK_TODAY).toISOString() : undefined,
    };
  },
);

/** Ручной анализ системности (QUALITY_MANAGER) — приоритетнее LLM-пометки (§17.3, УК-46). */
export const updateSystemicScope = createAsyncThunk<Proposal | null, { id: string; note: string }, { state: RootState }>(
  'governance/systemic-scope',
  async ({ id, note }, { getState }) => {
    if (isLive(getState())) return await govApi(`/proposals/${id}/systemic-scope`, 'PATCH', { note });
    const p = getState().governance.proposals.find((x) => x.id === id);
    if (!p) return null;
    return { ...p, systemicScopeNote: note, systemicScopeSystemCount: 1, systemicScopeLlmNote: undefined };
  },
);

/** Альтернативные варианты решения на карточке эскалации (§17.3, УК-48). */
export const updateAlternatives = createAsyncThunk<Proposal | null, { id: string; alternatives: AlternativeSolution[] }, { state: RootState }>(
  'governance/alternatives',
  async ({ id, alternatives }, { getState }) => {
    if (isLive(getState())) return await govApi(`/proposals/${id}/alternatives`, 'PATCH', { alternatives });
    const p = getState().governance.proposals.find((x) => x.id === id);
    if (!p) return null;
    return { ...p, alternativeSolutions: alternatives };
  },
);

/** Обязательное ревью LLM-рекомендации перед эскалацией (§17.6, УК-56). */
export const reviewLlmMeasure = createAsyncThunk<Proposal | null, { id: string; approved: boolean; comment?: string }, { state: RootState }>(
  'governance/llm-review',
  async ({ id, approved, comment }, { getState }) => {
    if (isLive(getState())) return await govApi(`/proposals/${id}/llm-review`, 'POST', { approved, comment });
    const p = getState().governance.proposals.find((x) => x.id === id);
    if (!p) return null;
    return approved
      ? { ...p, llmReviewedBy: 'demo', llmReviewedAt: new Date().toISOString() }
      : { ...p, measureSource: 'MANUAL' as const, llmReviewedBy: undefined, llmReviewedAt: undefined };
  },
);

/** Временный справочник направлений (§17.3, УК-47) — характеристика → направление. */
export async function fetchMeasureDepartments(): Promise<MeasureDepartment[]> {
  return govApi('/measure-departments', 'GET');
}

export async function upsertMeasureDepartment(characteristic: string, departmentName: string): Promise<MeasureDepartment> {
  return govApi('/measure-departments', 'PUT', { characteristic, departmentName });
}
