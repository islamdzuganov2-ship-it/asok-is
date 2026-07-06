/**
 * governance.test.ts — юнит-тесты слоя мер качества (ТЗ v14 §5):
 * правки меры топ-менеджером пишутся в историю изменений (аудит),
 * демо-набор мер — ролевой (ответственные по характеристикам, эскалации по критичности).
 */
import { describe, expect, it } from 'vitest';
import reducer, { editProposal, type Proposal } from '../store/slices/governanceSlice';
import { SCALE_PROPOSALS } from '../data/mockScaleData';

const mkState = (proposals: Proposal[]) => ({ proposals: proposals.map((p) => ({ ...p })) });

describe('editProposal: аудит правок', () => {
  const base = SCALE_PROPOSALS[0];

  it('пишет каждое изменённое поле в history (кто, когда, было → стало)', () => {
    const state = mkState([base]);
    const next = reducer(state as any, editProposal({
      id: base.id, by: 'CTO (Проверяющий)',
      patch: { owner: 'Новый О.О.', dueDate: '01.09.2026' },
    }));
    const p = next.proposals.find((x) => x.id === base.id)!;
    expect(p.owner).toBe('Новый О.О.');
    expect(p.dueDate).toBe('01.09.2026');
    expect(p.history).toHaveLength(2);
    const fields = p.history!.map((h) => h.field).sort();
    expect(fields).toEqual(['dueDate', 'owner']);
    for (const h of p.history!) {
      expect(h.by).toBe('CTO (Проверяющий)');
      expect(h.at).toBeTruthy();
      expect(h.to).toBeTruthy();
    }
    const ownerChange = p.history!.find((h) => h.field === 'owner')!;
    expect(ownerChange.from).toBe(base.owner);
  });

  it('не пишет в историю поля без изменений', () => {
    const state = mkState([base]);
    const next = reducer(state as any, editProposal({
      id: base.id, by: 'CTO', patch: { owner: base.owner },
    }));
    expect(next.proposals.find((x) => x.id === base.id)!.history).toBeUndefined();
  });

  it('последовательные правки накапливаются в истории', () => {
    let state: any = mkState([base]);
    state = reducer(state, editProposal({ id: base.id, by: 'CTO', patch: { dueDate: '01.08.2026' } }));
    state = reducer(state, editProposal({ id: base.id, by: 'CIO', patch: { dueDate: '15.08.2026' } }));
    const p = state.proposals.find((x: Proposal) => x.id === base.id)!;
    expect(p.history).toHaveLength(2);
    expect(p.history![1].from).toBe('01.08.2026');
    expect(p.history![1].to).toBe('15.08.2026');
  });
});

describe('SCALE_PROPOSALS: ролевой демо-набор', () => {
  it('ответственные различаются по характеристикам (не один человек на всё)', () => {
    expect(new Set(SCALE_PROPOSALS.map((p) => p.owner)).size).toBeGreaterThan(2);
  });

  it('есть эскалации с причиной, часть — с решением топ-менеджмента', () => {
    const escalated = SCALE_PROPOSALS.filter((p) => p.escalated);
    expect(escalated.length).toBeGreaterThan(0);
    for (const p of escalated) expect(p.escalationReason).toBeTruthy();
    expect(escalated.some((p) => p.escalationDecision === 'REQUEST_MEASURES')).toBe(true);
  });

  it('каждая мера несёт контекст для ЛПР: ожидание, обоснование, срок', () => {
    for (const p of SCALE_PROPOSALS) {
      expect(p.expectation).toBeTruthy();
      expect(p.rationale).toBeTruthy();
      expect(p.dueDate).toBeTruthy();
      expect(p.systemName).toBeTruthy();
      expect(p.characteristic).toBeTruthy();
    }
  });
});
