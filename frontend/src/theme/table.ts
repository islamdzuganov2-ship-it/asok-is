/**
 * table.ts — правила подачи табличных данных (UI-02, UI-08).
 *
 * Продукт аналитический: таблицы с процентами и счётчиками есть на каждом экране. Числа,
 * выровненные по левому краю, — самый узнаваемый признак «сделано на скорую руку»: разряды
 * не встают друг под друга, и колонку нельзя просмотреть взглядом сверху вниз.
 *
 * Поэтому числовая колонка описывается ХЕЛПЕРОМ, а не набором пропсов вручную: инвариант
 * («вправо + табличные цифры») держится по построению и не зависит от внимательности автора.
 */
import type { ColumnType } from 'antd/es/table';

/**
 * Числовая колонка: выравнивание вправо + моноширинные цифры.
 *
 * `tabular-nums` включается классом `num` (см. `styles/ui.css`): в пропорциональном шрифте
 * цифры разной ширины — «11%» уже «88%», из-за чего колонка дёргается при обновлении данных
 * и строки не совпадают по вертикали.
 *
 * Использование: `numericColumn({ title: 'Балл', dataIndex: 'score', width: 90 })`.
 *
 * Про типы: аргумент принимается широко (`ColumnType<any>`), а тип результата берётся из
 * контекста — из `ColumnsType<Row>`, куда колонка кладётся. Иначе TypeScript выводит параметр
 * из `dataIndex` и получает `ColumnType<'score'>` вместо строки данных. Плата за это —
 * `render` внутри не типизирован по строке, поэтому аргументы там аннотируются явно
 * (`(v: number)`), как и было в существующих колонках.
 */
export function numericColumn<T = any>(col: ColumnType<any>): ColumnType<T> {
  return {
    align: 'right',
    className: 'num',
    onHeaderCell: () => ({ className: 'num' }),
    ...col,
  } as ColumnType<T>;
}

/** Стиль для одиночного числа вне таблицы (показатель в карточке, счётчик в заголовке). */
export const numericText = { fontVariantNumeric: 'tabular-nums' } as const;

/**
 * ТЗ v19 п.11-12: сортировка по каждому содержательному столбцу везде, не точечно.
 *
 * Один компаратор на все типы данных вместо ручного `(a,b) => a.x - b.x` в каждой колонке —
 * тот код молча ломается на `null`/`undefined` (NaN расползается по всей сортировке) и на
 * смеси чисел со строками («невозможно измерить» рядом с процентами). Здесь: null/undefined
 * всегда в конец (не мешают увидеть реальные значения ни по возрастанию, ни по убыванию),
 * числа — арифметически, всё остальное — локализованным сравнением строк (ru).
 *
 * Использование: `sorter: sorterFor((r) => r.score)` вместо `sorter: (a, b) => a.score - b.score`.
 *
 * ТЗ v19 п.12 (УК-28): «нет данных» — в конец НЕЗАВИСИМО от направления. antd при сортировке по
 * убыванию переворачивает знак компаратора целиком, и без поправки строки без данных взлетали
 * наверх. Поэтому компаратор принимает третий аргумент antd — направление — и для пустых
 * значений отдаёт знак, который после переворота всё равно оставит их внизу. Строки сравниваются
 * без учёта регистра и с «ё» = «е» на первичном уровне (Intl.Collator 'ru', sensitivity: base).
 */
const RU = new Intl.Collator('ru', { sensitivity: 'base', numeric: true });

export type SortDirection = 'ascend' | 'descend' | null | undefined;

export function compareValues(
  av: string | number | boolean | null | undefined,
  bv: string | number | boolean | null | undefined,
  direction?: SortDirection,
): number {
  const aMissing = av === null || av === undefined || (typeof av === 'number' && Number.isNaN(av));
  const bMissing = bv === null || bv === undefined || (typeof bv === 'number' && Number.isNaN(bv));
  const last = direction === 'descend' ? -1 : 1;   // знак «в конец» с учётом переворота antd
  if (aMissing && bMissing) return 0;
  if (aMissing) return last;
  if (bMissing) return -last;
  if (typeof av === 'number' && typeof bv === 'number') return av - bv;
  if (typeof av === 'boolean' || typeof bv === 'boolean') return Number(av) - Number(bv);
  return RU.compare(String(av), String(bv));
}

export function sorterFor<T>(accessor: (row: T) => string | number | boolean | null | undefined) {
  return (a: T, b: T, direction?: SortDirection): number => compareValues(accessor(a), accessor(b), direction);
}

/** Стабильная сортировка массива тем же компаратором — для не-antd списков (теплокарта, экспорт). */
export function sortRows<T>(
  rows: readonly T[], accessor: (row: T) => string | number | boolean | null | undefined,
  direction: 'ascend' | 'descend',
): T[] {
  const sign = direction === 'descend' ? -1 : 1;
  return rows
    .map((row, i) => ({ row, i }))
    .sort((x, y) => {
      const av = accessor(x.row);
      const bv = accessor(y.row);
      const aMissing = av === null || av === undefined;
      const bMissing = bv === null || bv === undefined;
      if (aMissing || bMissing) return aMissing === bMissing ? x.i - y.i : aMissing ? 1 : -1;
      return sign * compareValues(av, bv) || x.i - y.i;
    })
    .map((x) => x.row);
}
