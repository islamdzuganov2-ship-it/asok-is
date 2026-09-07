/**
 * sliceUrl.test.ts — контракт сериализации сквозного разреза (ТЗ v21 §3.2, КП-06).
 *
 * Разрез живёт в адресной строке, а ссылками делятся: договор «что записали — то и прочли»
 * и совместимость со старыми ключами должны держаться тестом, а не памятью.
 */
import { describe, it, expect } from 'vitest';
import { DEFAULT_SLICE, activeFilterCount, isSliceEmpty, type Slice } from '../store/slice/sliceTypes';
import { paramsToSlice, sliceToParams, criticalityClasses, sliceSummaryText } from '../store/slice/sliceUrl';

const parse = (qs: string) => paramsToSlice(new URLSearchParams(qs));

describe('разрез ↔ адресная строка', () => {
  it('пустой адрес даёт разрез по умолчанию — весь портфель', () => {
    expect(parse('')).toEqual(DEFAULT_SLICE);
    expect(isSliceEmpty(parse(''))).toBe(true);
  });

  it('что записали — то и прочли (round-trip)', () => {
    const s: Slice = {
      period: '2026-Q2',
      systems: ['sys-1', 'sys-2'],
      criticality: ['MC', 'BO'],
      characteristic: 'Надёжность',
      subcharacteristic: 'Отказоустойчивость',
      owner: 'Иванов И.И.',
    };
    expect(paramsToSlice(sliceToParams(s))).toEqual(s);
  });

  it('разрез по умолчанию не оставляет мусора в адресе', () => {
    expect(sliceToParams(DEFAULT_SLICE).toString()).toBe('');
  });

  it('понимает старые ключи страниц (system, characteristic) как синонимы', () => {
    const s = parse('system=CRM&characteristic=Надёжность');
    expect(s.systems).toEqual(['CRM']);
    expect(s.characteristic).toBe('Надёжность');
  });

  it('при записи старые синонимы вычищаются — ссылка не несёт двух правд', () => {
    const out = sliceToParams(
      { ...DEFAULT_SLICE, systems: ['sys-9'] },
      new URLSearchParams('system=CRM&characteristic=Надёжность'),
    );
    expect(out.get('sys')).toBe('sys-9');
    expect(out.get('system')).toBeNull();
    expect(out.get('characteristic')).toBeNull();
  });

  it('чужие параметры адреса сохраняются', () => {
    const out = sliceToParams({ ...DEFAULT_SLICE, owner: 'Петров' }, new URLSearchParams('from=cockpit&role=ceo'));
    expect(out.get('from')).toBe('cockpit');
    expect(out.get('role')).toBe('ceo');
    expect(out.get('owner')).toBe('Петров');
  });

  it('мусорный класс критичности отбрасывается, а не ломает разрез', () => {
    expect(parse('crit=MC,ЧЕПУХА,BO').criticality).toEqual(['MC', 'BO']);
  });

  it('классы критичности разворачиваются в формат бэкенда', () => {
    expect(criticalityClasses({ ...DEFAULT_SLICE, criticality: ['MC', 'BC'] }))
      .toEqual(['MISSION CRITICAL', 'BUSINESS CRITICAL']);
  });

  it('счётчик активных фильтров считает только реально суженное', () => {
    expect(activeFilterCount(DEFAULT_SLICE)).toBe(0);
    expect(activeFilterCount({ ...DEFAULT_SLICE, systems: ['a'], characteristic: 'Надёжность' })).toBe(2);
  });

  it('резюме честно говорит «весь портфель», когда разрез пуст', () => {
    expect(sliceSummaryText(DEFAULT_SLICE)).toContain('Весь портфель');
    expect(sliceSummaryText({ ...DEFAULT_SLICE, systems: ['a', 'b'] })).toContain('2 ИС');
  });
});
