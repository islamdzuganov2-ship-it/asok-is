/**
 * sliceUrl.test.ts — контракт сериализации разреза (ТЗ v21 §3, критерии КП-ПР-3/КП-ПР-6).
 *
 * Регресс, который закрывают тесты: восемь страниц уже читали параметры адресной строки
 * СВОИМИ ключами (`characteristic`, `system`, `owner`) — общего словаря не было, поэтому
 * переход между разделами терял контекст. paramsToSlice обязан понимать старые ключи как
 * синонимы новых, не ломая существующие ссылки (КП-ПР-6); sliceToParams обязан быть точной
 * обратной операцией, иначе скопированная ссылка не воспроизводит экран (КП-ПР-4).
 */
import { describe, it, expect } from 'vitest';
import { sliceToParams, paramsToSlice, sliceSummaryText } from '../store/slice/sliceUrl';
import { DEFAULT_SLICE, activeFilterCount, type Slice } from '../store/slice/sliceTypes';

describe('paramsToSlice — дефолты и разбор', () => {
  it('пустые параметры дают DEFAULT_SLICE', () => {
    expect(paramsToSlice(new URLSearchParams())).toEqual(DEFAULT_SLICE);
  });

  it('разбирает полный набор новых ключей', () => {
    const p = new URLSearchParams('p=2026-Q2&sys=a1,b2&crit=MC,BC&char=Надёжность&sub=Отказоустойчивость&owner=Иванов&lens=ale');
    const s = paramsToSlice(p);
    expect(s).toEqual({
      period: '2026-Q2', systems: ['a1', 'b2'], criticality: ['MC', 'BC'],
      characteristic: 'Надёжность', subcharacteristic: 'Отказоустойчивость', owner: 'Иванов', lens: 'ale',
    });
  });

  it('игнорирует неизвестный код критичности вместо падения', () => {
    const s = paramsToSlice(new URLSearchParams('crit=MC,ZZ'));
    expect(s.criticality).toEqual(['MC']);
  });

  it('игнорирует неизвестную линзу, использует дефолт', () => {
    const s = paramsToSlice(new URLSearchParams('lens=bogus'));
    expect(s.lens).toBe('score');
  });
});

describe('paramsToSlice — обратная совместимость со старыми ключами (КП-ПР-6)', () => {
  it('?characteristic= (ExecutiveDashboard, TaskPlanDashboard) читается как char', () => {
    const s = paramsToSlice(new URLSearchParams('characteristic=Защищённость'));
    expect(s.characteristic).toBe('Защищённость');
  });

  it('?system= (IncidentsAnalyticsPage) читается как sys', () => {
    const s = paramsToSlice(new URLSearchParams('system=АБС Core'));
    expect(s.systems).toEqual(['АБС Core']);
  });

  it('новый ключ имеет приоритет, если оба присутствуют', () => {
    const s = paramsToSlice(new URLSearchParams('char=Старое&characteristic=Игнорируется'));
    expect(s.characteristic).toBe('Старое');
  });
});

describe('sliceToParams — сериализация обратно в URL (КП-ПР-4: воспроизводимая ссылка)', () => {
  it('DEFAULT_SLICE не производит ни одного параметра', () => {
    expect(sliceToParams(DEFAULT_SLICE).toString()).toBe('');
  });

  it('roundtrip: paramsToSlice(sliceToParams(x)) === x для непустого разреза', () => {
    const s: Slice = {
      period: '2026-Q3', systems: ['sys-1'], criticality: ['MC'],
      characteristic: 'Надёжность', subcharacteristic: null, owner: 'Петров', lens: 'coverage',
    };
    const roundtripped = paramsToSlice(sliceToParams(s));
    expect(roundtripped).toEqual(s);
  });

  it('сохраняет посторонние параметры адреса (например, &tile=)', () => {
    const base = new URLSearchParams('tile=ceo-cost');
    const out = sliceToParams({ ...DEFAULT_SLICE, characteristic: 'Надёжность' }, base);
    expect(out.get('tile')).toBe('ceo-cost');
    expect(out.get('char')).toBe('Надёжность');
  });
});

describe('activeFilterCount / sliceSummaryText', () => {
  it('ноль фильтров для дефолтного разреза', () => {
    expect(activeFilterCount(DEFAULT_SLICE)).toBe(0);
  });

  it('считает по одному на непустое поле, не по значению', () => {
    const s: Slice = { ...DEFAULT_SLICE, systems: ['a', 'b', 'c'], owner: 'Иванов' };
    expect(activeFilterCount(s)).toBe(2);
  });

  it('резюме читаемо для свёрнутой панели разреза', () => {
    expect(sliceSummaryText(DEFAULT_SLICE)).toBe('Весь портфель · последний период · все классы');
  });
});
