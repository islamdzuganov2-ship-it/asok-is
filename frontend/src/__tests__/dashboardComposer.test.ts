/**
 * dashboardComposer.test.ts — инварианты конструктора дашбордов (ТЗ v22, БТ-500).
 *
 * Проверяются две вещи, которые ломаются молча и потому опаснее всего:
 *  1) слияние сохранённой раскладки с каталогом — карточка без права или выкинутая из релиза
 *     не должна попасть на экран, а настройки формата v1 не должны потеряться;
 *  2) перестановка пунктов меню — плоский порядок при трёх группах на экране.
 *
 * Каталог карточек сюда НЕ импортируется намеренно: он тянет за собой все модули карточек
 * (antd, ECharts), а правила слияния к React отношения не имеют — справочник передаётся
 * функцией `lookup` (см. layoutMath).
 */
import { describe, it, expect } from 'vitest';
import {
  layoutFromWidgets, sanitize, nextFreeRow, geometryOf, type CardMeta,
} from '../dashboards/layoutMath';
import { cardAllowed, GRID_COLS } from '../dashboards/types';
import { fullNavOrder, groupOfPerm, moveNavItem, type NavSection } from '../constants/navOrderMath';

// Мини-каталог: три карточки риск-дашборда и одна управленческая (доступна CTO ИЛИ CEO).
const CARDS: Record<string, CardMeta> = {
  'risk.kpi': { w: 12, h: 5, perm: 'view.dashboard.risk' },
  'risk.triggers': { w: 6, h: 11, perm: 'view.dashboard.risk' },
  'risk.topSystems': { w: 6, h: 11, perm: 'view.dashboard.risk' },
  'exec.heatmap': { w: 8, h: 17, perm: ['view.dashboard.cto', 'view.dashboard.ceo'] },
};
const lookup = (id: string): CardMeta | undefined => CARDS[id];

describe('раскладка дашборда: слияние с каталогом', () => {
  it('legacy-формат v1 разворачивается в столбец, выключенные виджеты отброшены', () => {
    const rows = layoutFromWidgets(
      [
        { id: 'triggers', enabled: true, order: 1 },
        { id: 'kpi', enabled: true, order: 0 },
        { id: 'topSystems', enabled: false, order: 2 },
      ],
      'risk',
      lookup,
    );
    // Префикс дашборда достроен, порядок — по order, выключенный виджет не попал.
    expect(rows.map((r) => r.i)).toEqual(['risk.kpi', 'risk.triggers']);
    // Один столбец во всю ширину, вторая карточка начинается там, где кончилась первая.
    expect(rows.every((r) => r.x === 0 && r.w === GRID_COLS)).toBe(true);
    expect(rows[0].y).toBe(0);
    expect(rows[1].y).toBe(CARDS['risk.kpi'].h);
  });

  it('виджет, которого больше нет в каталоге, не ломает конвертацию', () => {
    const rows = layoutFromWidgets(
      [
        { id: 'kpi', enabled: true, order: 0 },
        { id: 'убранныйВРелизе', enabled: true, order: 1 },
      ],
      'risk',
      lookup,
    );
    expect(rows.map((r) => r.i)).toEqual(['risk.kpi']);
  });

  it('sanitize выкидывает карточки без права — RBAC остаётся верхней границей', () => {
    const layout = [
      { i: 'risk.kpi', x: 0, y: 0, w: 12, h: 5 },
      { i: 'exec.heatmap', x: 0, y: 5, w: 8, h: 17 },
    ];
    const rows = sanitize(layout, ['view.dashboard.risk'], lookup);
    expect(rows.map((r) => r.i)).toEqual(['risk.kpi']);
  });

  it('sanitize принимает карточку, если есть ЛЮБОЕ из перечисленных прав (CTO или CEO)', () => {
    const layout = [{ i: 'exec.heatmap', x: 0, y: 0, w: 8, h: 17 }];
    expect(sanitize(layout, ['view.dashboard.ceo'], lookup)).toHaveLength(1);
    expect(sanitize(layout, ['view.dashboard.cto'], lookup)).toHaveLength(1);
    expect(sanitize(layout, ['view.dashboard.manager'], lookup)).toHaveLength(0);
  });

  it('sanitize убирает дубли и неизвестные id', () => {
    const layout = [
      { i: 'risk.kpi', x: 0, y: 0, w: 12, h: 5 },
      { i: 'risk.kpi', x: 0, y: 5, w: 12, h: 5 },
      { i: 'нет.такой', x: 0, y: 10, w: 12, h: 5 },
    ];
    expect(sanitize(layout, ['view.dashboard.risk'], lookup).map((r) => r.i)).toEqual(['risk.kpi']);
  });

  it('новая карточка встаёт под всей раскладкой, а не поверх соседей', () => {
    const layout = [
      { i: 'risk.kpi', x: 0, y: 0, w: 12, h: 5 },
      { i: 'risk.triggers', x: 0, y: 5, w: 6, h: 11 },
    ];
    expect(nextFreeRow(layout)).toBe(16);
    expect(nextFreeRow([])).toBe(0);
  });

  it('в prefs пишется только геометрия — служебные поля react-grid-layout отбрасываются', () => {
    const withNoise = [{ i: 'risk.kpi', x: 0, y: 0, w: 12, h: 5, static: false, moved: true } as any];
    expect(geometryOf(withNoise)).toEqual([{ i: 'risk.kpi', x: 0, y: 0, w: 12, h: 5 }]);
  });

  it('cardAllowed: пустой список прав не открывает ничего', () => {
    expect(cardAllowed({ perm: 'view.dashboard.risk' }, [])).toBe(false);
    expect(cardAllowed({ perm: ['a', 'b'] }, ['b'])).toBe(true);
  });
});

const SECTIONS: NavSection[] = [
  { perm: 'my', group: 'Основное' },
  { perm: 'cto', group: 'Основное' },
  { perm: 'manager', group: 'Основное' },
  { perm: 'incidents', group: 'Сбор и анализ данных' },
  { perm: 'reports', group: 'Сбор и анализ данных' },
  { perm: 'taskplan', group: 'Формирование техдолга' },
];

describe('порядок пунктов левого меню', () => {
  it('без пользовательского порядка сохраняется исходный', () => {
    expect(fullNavOrder(SECTIONS, [])).toEqual(['my', 'cto', 'manager', 'incidents', 'reports', 'taskplan']);
  });

  it('разделы без сохранённого порядка идут ПОСЛЕ настроенных, между собой — в исходном порядке', () => {
    // Пользователь настраивал меню, когда 'manager' и 'taskplan' ещё не существовали.
    const order = fullNavOrder(SECTIONS, ['cto', 'my', 'incidents', 'reports']);
    // Контракт ДЕФ-14: сохранённый порядок соблюдается дословно…
    expect(order.slice(0, 4)).toEqual(['cto', 'my', 'incidents', 'reports']);
    // …а новые разделы идут следом и между собой сохраняют порядок NAV_SECTIONS
    // ('manager' объявлен раньше 'taskplan'), а не сыплются как попало.
    expect(order.slice(4)).toEqual(['manager', 'taskplan']);
  });

  it('перетаскивание ставит пункт ПЕРЕД целевым', () => {
    const { navOrder } = moveNavItem('taskplan', 'Основное', 'cto', SECTIONS, [], {});
    expect(navOrder.indexOf('taskplan')).toBe(navOrder.indexOf('cto') - 1);
  });

  it('перенос в другую группу запоминается, возврат в родную — стирается', () => {
    const moved = moveNavItem('taskplan', 'Основное', 'cto', SECTIONS, [], {});
    expect(moved.navGroups.taskplan).toBe('Основное');
    expect(groupOfPerm('taskplan', SECTIONS, moved.navGroups)).toBe('Основное');

    // Возврат в штатную группу не пишет переопределение, равное дефолту, — оно удаляется.
    const back = moveNavItem('taskplan', 'Формирование техдолга', null, SECTIONS, moved.navOrder, moved.navGroups);
    expect(back.navGroups).not.toHaveProperty('taskplan');
    expect(groupOfPerm('taskplan', SECTIONS, back.navGroups)).toBe('Формирование техдолга');
  });

  it('дроп на пустую область группы отправляет пункт в конец списка', () => {
    const { navOrder } = moveNavItem('my', 'Формирование техдолга', null, SECTIONS, [], {});
    expect(navOrder[navOrder.length - 1]).toBe('my');
  });

  it('перестановка не теряет и не дублирует пункты', () => {
    const { navOrder } = moveNavItem('reports', 'Основное', 'manager', SECTIONS, [], {});
    expect([...navOrder].sort()).toEqual(SECTIONS.map((s) => s.perm).sort());
  });
});
