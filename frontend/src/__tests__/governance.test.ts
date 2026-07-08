/**
 * governance.test.ts — юнит-тесты слоя мер качества (ТЗ v14 §5):
 * правки меры топ-менеджером пишутся в историю изменений (аудит),
 * демо-набор мер — ролевой (ответственные по характеристикам, эскалации по критичности).
 *
 * T-10: логика правки вынесена в чистую функцию applyEdit (используется thunk editProposal
 * в mock-режиме; в live историю ведёт бэкенд). Тест проверяет именно её.
 */
import { describe, expect, it } from 'vitest';
import { applyEdit } from '../store/slices/governanceSlice';
import { SCALE_PROPOSALS } from '../data/mockScaleData';

describe('applyEdit: аудит правок меры (mock-режим)', () => {
  const base = SCALE_PROPOSALS[0];

  it('пишет каждое изменённое поле в history (кто, когда, было → стало)', () => {
    const p = applyEdit(base, { owner: 'Новый О.О.', dueDate: '01.09.2026' }, 'CTO (Проверяющий)')!;
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

  it('не пишет в историю поля без изменений (возвращает null)', () => {
    expect(applyEdit(base, { owner: base.owner }, 'CTO')).toBeNull();
  });

  it('последовательные правки накапливаются в истории', () => {
    let p = applyEdit(base, { dueDate: '01.08.2026' }, 'CTO')!;
    p = applyEdit(p, { dueDate: '15.08.2026' }, 'CIO')!;
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
