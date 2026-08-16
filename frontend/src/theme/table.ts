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
 */
export function sorterFor<T>(accessor: (row: T) => string | number | boolean | null | undefined) {
  return (a: T, b: T): number => {
    const av = accessor(a);
    const bv = accessor(b);
    const aMissing = av === null || av === undefined;
    const bMissing = bv === null || bv === undefined;
    if (aMissing && bMissing) return 0;
    if (aMissing) return 1;
    if (bMissing) return -1;
    if (typeof av === 'number' && typeof bv === 'number') return av - bv;
    if (typeof av === 'boolean' || typeof bv === 'boolean') return Number(av) - Number(bv);
    return String(av).localeCompare(String(bv), 'ru');
  };
}
