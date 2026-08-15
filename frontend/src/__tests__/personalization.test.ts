/**
 * Персонализация меню: состав и порядок разделов (ДЕФ-12, ДЕФ-14 / БТ-444, БТ-445).
 *
 * Регресс, который закрывают тесты:
 *  · флагов было 4 на 9 дашбордов, и действовали они ТОЛЬКО для ADMIN/CTO/CEO — менеджер
 *    по качеству щёлкал тумблер в «Настройка», и ничего не происходило;
 *  · порядок разделов не настраивался вовсе, drag & drop не был реализован.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  uiReducer, setSectionVisible, setNavOrder, resetPersonalization, NAV_SECTIONS,
  loadHidden, loadOrder,
} from '../store/slices/uiSlice';

const initial = () => uiReducer(undefined, { type: '@@INIT' });

/** Тот же порядок, что строит AppLayout: сначала по navOrder, остальные — как в NAV_SECTIONS. */
const menuOf = (state: ReturnType<typeof initial>, permissions: string[]): string[] => {
  const idx = (perm: string) => {
    const i = state.navOrder.indexOf(perm);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  return NAV_SECTIONS
    .filter((s) => permissions.includes(s.perm) && !state.hiddenSections[s.perm])
    .slice()
    .sort((a, b) => idx(a.perm) - idx(b.perm))
    .map((s) => s.label);
};

const MANAGER_PERMS = [
  'view.dashboard.manager', 'view.dashboard.analytics', 'view.dashboard.dynamics',
  'view.assessments', 'view.dashboard.incidents', 'view.risks',
  'view.risk_economics', 'view.reports', 'view.dashboard.taskplan',
];

describe('персонализация меню', () => {
  beforeEach(() => localStorage.clear());

  it('каждый раздел меню доступен для настройки', () => {
    // ДЕФ-12: тумблеров было меньше, чем разделов — часть меню настроить было нельзя.
    expect(NAV_SECTIONS.length).toBeGreaterThanOrEqual(14);
    const perms = NAV_SECTIONS.map((s) => s.perm);
    expect(new Set(perms).size).toBe(perms.length);   // без дублей
    for (const key of ['view.dashboard.cto', 'view.dashboard.ceo', 'view.dashboard.manager',
      'view.dashboard.risk', 'view.dashboard.risk_radar']) {
      expect(perms).toContain(key);                   // раньше у этих пяти тумблера не было
    }
  });

  it('разделы разложены по группам из ТЗ (БТ-038)', () => {
    const groups = new Set(NAV_SECTIONS.map((s) => s.group));
    expect([...groups].sort()).toEqual(
      ['Основное', 'Сбор и анализ данных', 'Формирование техдолга'].sort(),
    );
  });

  it('скрытие работает для роли, не входящей в топ-менеджмент', () => {
    let state = initial();
    expect(menuOf(state, MANAGER_PERMS)).toContain('База рисков');
    state = uiReducer(state, setSectionVisible({ perm: 'view.risks', visible: false }));
    expect(menuOf(state, MANAGER_PERMS)).not.toContain('База рисков');
  });

  it('скрытие не даёт доступа сверх прав роли', () => {
    let state = initial();
    state = uiReducer(state, setSectionVisible({ perm: 'view.dashboard.cto', visible: true }));
    // Права CTO у менеджера нет — пункт не появляется, сколько ни включай.
    expect(menuOf(state, MANAGER_PERMS)).not.toContain('Дашборд CTO');
  });

  it('порядок разделов применяется к меню', () => {
    let state = initial();
    const before = menuOf(state, MANAGER_PERMS);
    expect(before.indexOf('Внесение данных')).toBeLessThan(before.indexOf('Отчёты'));

    state = uiReducer(state, setNavOrder(['view.reports', 'view.assessments']));
    const after = menuOf(state, MANAGER_PERMS);
    expect(after.indexOf('Отчёты')).toBeLessThan(after.indexOf('Внесение данных'));
  });

  it('раздел, которого нет в сохранённом порядке, не пропадает', () => {
    // Новый раздел из релиза обязан появиться сам, а не ждать ручной настройки.
    let state = initial();
    state = uiReducer(state, setNavOrder(['view.reports']));
    expect(menuOf(state, MANAGER_PERMS)).toContain('План задач');
  });

  it('сброс возвращает вид по умолчанию', () => {
    let state = initial();
    state = uiReducer(state, setSectionVisible({ perm: 'view.risks', visible: false }));
    state = uiReducer(state, setNavOrder(['view.reports']));
    state = uiReducer(state, resetPersonalization());
    expect(state.hiddenSections).toEqual({});
    expect(state.navOrder).toEqual([]);
    expect(menuOf(state, MANAGER_PERMS)).toContain('База рисков');
  });

  it('настройки переживают перезагрузку страницы', () => {
    // initialState считается один раз при загрузке модуля, поэтому проверяем сам контракт
    // чтения: что попадёт в стор при следующем запуске приложения.
    let state = initial();
    state = uiReducer(state, setSectionVisible({ perm: 'view.risks', visible: false }));
    state = uiReducer(state, setNavOrder(['view.reports', 'view.assessments']));

    expect(loadHidden()['view.risks']).toBe(true);
    expect(loadOrder()[0]).toBe('view.reports');
  });

  it('понимает прежний формат флагов (ТЗ v17)', () => {
    // Раньше хранились булевы флаги вида {execIncidents: false}; настройка не должна теряться.
    localStorage.setItem('asok_exec_features', JSON.stringify({
      execAnalytics: true, execIncidents: false,
    }));
    const hidden = loadHidden();
    expect(hidden['view.dashboard.incidents']).toBe(true);
    expect(hidden['view.dashboard.analytics']).toBeUndefined();
  });

  it('битые данные в localStorage не ломают запуск', () => {
    localStorage.setItem('asok_exec_features', 'не json');
    localStorage.setItem('asok_nav_order', '{{');
    expect(loadHidden()).toEqual({});
    expect(loadOrder()).toEqual([]);
  });
});
