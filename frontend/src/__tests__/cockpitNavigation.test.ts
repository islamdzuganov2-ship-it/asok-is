/**
 * cockpitNavigation.test.ts — остаток Ф6/Ф7 кокпита (ТЗ-21): возврат с L3 (КП-39), шторка L2
 * в адресе (КП-ПР-4), денежная линза (§3.1), тумблер «Демо/LLM» вне кокпита (КП-43).
 *
 * Всё, что здесь проверяется, ломается молча: ссылка «работает», но возвращает на чистый
 * кокпит; линза «выбирается», но теряется при пересылке ссылки; тумблер пропадает у админа.
 */
import { describe, it, expect } from 'vitest';
import {
  cockpitReturnTarget, isSafeReturn, withCockpitReturn,
} from '../store/slice/cockpitReturn';
import { paramsToSlice, sliceToParams } from '../store/slice/sliceUrl';
import { activeFilterCount, isSliceEmpty, lensOf, DEFAULT_SLICE } from '../store/slice/sliceTypes';
import { moneyBySystem, sortForLens } from '../dashboards/cockpit/lensMath';
import { headerToggleVisible } from '../components/DataModeToggle';

describe('возврат с глубокой страницы на кокпит (КП-39)', () => {
  const cockpit = '/dashboard/ceo?sys=a1&crit=MC&tile=ceo-cost';

  it('ссылка из кокпита несёт полный адрес кокпита — разрез и открытую шторку', () => {
    const href = withCockpitReturn('/risk-economics?from=cockpit&role=ceo', cockpit);
    const p = new URLSearchParams(href.split('?')[1]);
    expect(p.get('ret')).toBe(cockpit);
    expect(cockpitReturnTarget(`?${p.toString()}`)).toBe(cockpit);
  });

  it('собственные параметры L3-страницы не затираются разрезом кокпита', () => {
    // Страница сбоев читает `system` (ИМЯ ИС): разрез кокпита не должен его вычищать.
    const href = withCockpitReturn('/dashboard/incidents?from=cockpit&role=cto&system=%D0%90%D0%91%D0%A1', cockpit);
    const p = new URLSearchParams(href.split('?')[1]);
    expect(p.get('system')).toBe('АБС');
    expect(p.get('sys')).toBeNull();
  });

  it('обычные ссылки (не из кокпита) не трогаются', () => {
    expect(withCockpitReturn('/risks?q=1', cockpit)).toBe('/risks?q=1');
  });

  it('старая ссылка без ret ведёт на посадочную роли; чужая страница кнопки не получает', () => {
    expect(cockpitReturnTarget('?from=cockpit&role=cto')).toBe('/dashboard/cto');
    expect(cockpitReturnTarget('?system=X')).toBeNull();
  });

  it('ret не превращается в открытый редирект', () => {
    for (const bad of ['https://evil.example/x', '//evil.example', '/\\evil', '/risks', 'javascript:alert(1)', '/dashboard//evil']) {
      expect(isSafeReturn(bad)).toBe(false);
      expect(cockpitReturnTarget(`?from=cockpit&role=ceo&ret=${encodeURIComponent(bad)}`)).toBe('/dashboard/ceo');
    }
  });
});

describe('шторка L2 в адресе (КП-ПР-4)', () => {
  it('запись разреза не стирает открытую шторку', () => {
    const base = new URLSearchParams('tile=cto-decisions');
    const p = sliceToParams({ ...DEFAULT_SLICE, systems: ['x'] }, base);
    expect(p.get('tile')).toBe('cto-decisions');
    expect(p.get('sys')).toBe('x');
  });
});

describe('денежная линза (ТЗ-21 §3.1)', () => {
  it('линза пишется в адрес и читается обратно; мусор отбрасывается', () => {
    const p = sliceToParams({ ...DEFAULT_SLICE, lens: 'delta' });
    expect(p.get('lens')).toBe('delta');
    expect(paramsToSlice(p).lens).toBe('delta');
    expect(paramsToSlice(new URLSearchParams('lens=bogus')).lens).toBeUndefined();
  });

  it('линза — способ показа, а не фильтр: разрез остаётся «пустым», счётчик фильтров — 0', () => {
    const s = paramsToSlice(new URLSearchParams('lens=ale'));
    expect(isSliceEmpty(s)).toBe(true);
    expect(activeFilterCount(s)).toBe(0);
  });

  it('без явной линзы действует дефолт экрана (CEO — ALE, CTO — балл)', () => {
    expect(lensOf(DEFAULT_SLICE, 'ale')).toBe('ale');
    expect(lensOf({ ...DEFAULT_SLICE, lens: 'coverage' }, 'ale')).toBe('coverage');
  });

  it('покрытие по ИС — средневзвешенное по ALE, а не среднее процентов', () => {
    const rows = moneyBySystem([
      { systemName: 'А', characteristic: 'x', totalAle: 9_000_000, totalDeltaAle: 1_000, coveragePct: 100 },
      { systemName: 'А', characteristic: 'y', totalAle: 1_000_000, totalDeltaAle: 500, coveragePct: 0 },
      { systemName: 'Б', characteristic: 'x', totalAle: 0, totalDeltaAle: 0, coveragePct: 0 },
    ]);
    const a = rows.find((r) => r.system === 'А')!;
    expect(a.ale).toBe(10_000_000);
    expect(a.delta).toBe(1_500);
    expect(a.coveragePct).toBe(90);           // не 50 — вес большой ячейки учтён
    expect(rows.find((r) => r.system === 'Б')!.coveragePct).toBeNull();   // нет ALE ≠ 0%
  });

  it('порядок в линзе: самое уязвимое сверху, «нет ALE» — в конце', () => {
    const rows = [
      { system: 'hi', ale: 5, delta: 1, coveragePct: 80 },
      { system: 'lo', ale: 9, delta: 7, coveragePct: 10 },
      { system: 'none', ale: 0, delta: 0, coveragePct: null },
    ];
    expect(sortForLens(rows, 'ale').map((r) => r.system)).toEqual(['lo', 'hi', 'none']);
    expect(sortForLens(rows, 'coverage').map((r) => r.system)).toEqual(['lo', 'hi', 'none']);
    expect(sortForLens(rows, 'delta')[0].system).toBe('lo');
  });
});

describe('тумблер «Демо/LLM» вне кокпита (КП-43)', () => {
  it('на кокпитах тумблер в шапке только у администраторов', () => {
    expect(headerToggleVisible('/dashboard/ceo', 'CEO')).toBe(false);
    expect(headerToggleVisible('/dashboard/cto', 'CTO')).toBe(false);
    expect(headerToggleVisible('/dashboard/ceo', 'ADMIN')).toBe(true);
    expect(headerToggleVisible('/dashboard/cto', 'SUPER_ADMIN')).toBe(true);
  });

  it('вне кокпита тумблер виден всем, как раньше', () => {
    expect(headerToggleVisible('/dashboard/manager', 'QUALITY_MANAGER')).toBe(true);
    expect(headerToggleVisible('/dashboard/ceo-archive', 'CEO')).toBe(true);
  });
});
