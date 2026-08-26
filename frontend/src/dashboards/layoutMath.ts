/**
 * layoutMath.ts — чистые операции над раскладкой дашборда.
 *
 * Вынесены из useDashboardLayout отдельным модулем без импорта реестра: каталог карточек тянет
 * за собой все их модули (antd, ECharts), а правила слияния раскладки к React отношения не имеют
 * и должны проверяться юнит-тестом напрямую. Поэтому справочник карточек передаётся сюда
 * функцией `lookup`.
 */
import { GRID_COLS, cardAllowed, type CardLayout } from './types';

/** Что модулю нужно знать о карточке: размер по умолчанию и требуемое право. */
export interface CardMeta {
  h: number;
  w: number;
  perm: string | string[];
}

export type CardLookup = (id: string) => CardMeta | undefined;

/**
 * Раскладка из legacy-формата v1 (`{id, enabled, order}`, BL-008 Фаза 4): один столбец,
 * порядок = порядок виджетов, выключенные отброшены.
 *
 * id виджетов был локальным для дашборда (`kpi`), в общем каталоге он полный (`risk.kpi`) —
 * достраиваем префикс, иначе настройки пользователей, сделанные до конструктора, потерялись бы.
 */
export function layoutFromWidgets(
  widgets: Array<{ id: string; enabled: boolean; order: number }>,
  prefix: string,
  lookup: CardLookup,
): CardLayout[] {
  let y = 0;
  const rows: CardLayout[] = [];
  widgets
    .slice()
    .sort((a, b) => a.order - b.order)
    .filter((w) => w.enabled)
    .forEach((w) => {
      const id = w.id.includes('.') ? w.id : `${prefix}.${w.id}`;
      const def = lookup(id);
      if (!def) return;
      rows.push({ i: id, x: 0, y, w: GRID_COLS, h: def.h });
      y += def.h;
    });
  return rows;
}

/**
 * Отбрасывает карточки, которых нет в каталоге, дубли и те, на которые у пользователя нет права.
 * RBAC остаётся верхней границей персонализации: право могли забрать уже после того, как
 * пользователь собрал дашборд.
 */
export function sanitize(layout: CardLayout[], permissions: readonly string[], lookup: CardLookup): CardLayout[] {
  const seen = new Set<string>();
  return layout.filter((row) => {
    const def = lookup(row.i);
    if (!def || seen.has(row.i) || !cardAllowed(def, permissions)) return false;
    seen.add(row.i);
    return true;
  });
}

/** Первая свободная строка под всей раскладкой — туда падает добавленная карточка. */
export function nextFreeRow(layout: CardLayout[]): number {
  return layout.reduce((max, row) => Math.max(max, row.y + row.h), 0);
}

/** Только геометрия: react-grid-layout навешивает на Layout свои поля (static, moved…), в prefs
 *  они не нужны и мешают сравнению «изменилось ли». */
export const geometryOf = (layout: CardLayout[]): CardLayout[] =>
  layout.map(({ i, x, y, w, h }) => ({ i, x, y, w, h }));
