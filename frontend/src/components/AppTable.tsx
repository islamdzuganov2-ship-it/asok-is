/**
 * AppTable.tsx — единая обёртка таблиц приложения (ТЗ v19 п.12, УК-28, УК-30).
 *
 * Зачем обёртка, а не договорённость: «следующая новая таблица снова появится без сортировки»
 * (УК-30). Здесь сортировка, её запоминание и экспорт держатся по построению:
 *  • у каждой колонки с `dataIndex` появляется сортировка тем же компаратором `sorterFor`
 *    (числа — арифметически, текст — по-русски с «ё» = «е», «нет данных» — всегда в конце);
 *    колонка без данных (кнопки, действия) помечается `sortable: false` или не имеет dataIndex;
 *  • выбранная сортировка запоминается по `tableKey` и восстанавливается при возврате на экран;
 *  • экспорт в CSV выгружает строки В ТОМ ЖЕ порядке, что на экране (УК-28, В-40).
 */
import React, { useMemo, useState } from 'react';
import { Button, Table, Tooltip } from 'antd';
import type { TableProps } from 'antd';
import type { ColumnType, SorterResult } from 'antd/es/table/interface';
import { DownloadOutlined } from '@ant-design/icons';
import { sortRows, sorterFor } from '../theme/table';

type Primitive = string | number | boolean | null | undefined;
export type AppColumn<T> = ColumnType<T> & { sortable?: false; exportValue?: (row: T) => Primitive };

interface SortState { key: string; order: 'ascend' | 'descend' }

const STORAGE_PREFIX = 'asok_table_sort:';

const loadSort = (tableKey: string): SortState | null => {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_PREFIX + tableKey) || 'null');
    return raw && typeof raw.key === 'string' && (raw.order === 'ascend' || raw.order === 'descend') ? raw : null;
  } catch { return null; }
};

const saveSort = (tableKey: string, s: SortState | null) => {
  try {
    if (s) localStorage.setItem(STORAGE_PREFIX + tableKey, JSON.stringify(s));
    else localStorage.removeItem(STORAGE_PREFIX + tableKey);
  } catch { /* приватное окно — сортировка просто не запомнится */ }
};

export const columnKey = <T,>(c: AppColumn<T>, i: number): string =>
  String(c.key ?? (Array.isArray(c.dataIndex) ? c.dataIndex.join('.') : c.dataIndex ?? `col${i}`));

export const valueAt = <T,>(row: T, dataIndex: ColumnType<T>['dataIndex']): Primitive => {
  const path = Array.isArray(dataIndex) ? dataIndex : dataIndex === undefined ? [] : [dataIndex];
  let v: any = row;
  for (const k of path) v = v?.[k as keyof typeof v];
  return v === undefined || v === null || typeof v === 'object' ? (v ?? null) : v;
};

const accessorOf = <T,>(c: AppColumn<T>) => (row: T): Primitive =>
  c.exportValue ? c.exportValue(row) : valueAt(row, c.dataIndex);

/** Колонки с гарантированной сортировкой (УК-28): своя сортировка колонки сохраняется. */
export function withSorters<T>(columns: AppColumn<T>[]): AppColumn<T>[] {
  return columns.map((c) => {
    if (c.sorter || c.sortable === false || c.dataIndex === undefined) return c;
    return { ...c, sorter: sorterFor(accessorOf(c)) };
  });
}

/** CSV (разделитель «;», BOM — Excel открывает кириллицу без мастера импорта). */
export function toCsv<T>(rows: readonly T[], columns: AppColumn<T>[]): string {
  const cols = columns.filter((c) => c.dataIndex !== undefined || c.exportValue);
  const esc = (v: Primitive) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = cols.map((c) => esc(typeof c.title === 'string' ? c.title : columnKey(c, 0)));
  const body = rows.map((r) => cols.map((c) => esc(accessorOf(c)(r))).join(';'));
  return '﻿' + [head.join(';'), ...body].join('\n');
}

interface AppTableProps<T> extends Omit<TableProps<T>, 'columns'> {
  /** Ключ запоминания сортировки — уникальный для экрана/карточки. */
  tableKey: string;
  columns: AppColumn<T>[];
  /** Имя файла экспорта; не задано — кнопки экспорта нет. */
  exportName?: string;
}

export function AppTable<T extends object>({ tableKey, columns, exportName, onChange, ...rest }: AppTableProps<T>) {
  const [sort, setSort] = useState<SortState | null>(() => loadSort(tableKey));
  const sortable = useMemo(() => withSorters(columns), [columns]);
  // Явный key у каждой колонки: по нему antd сообщает, какую колонку отсортировали.
  const controlled = useMemo(() => sortable.map((c, i) => {
    const key = columnKey(c, i);
    return c.sorter ? { ...c, key, sortOrder: sort && sort.key === key ? sort.order : null } : { ...c, key };
  }), [sortable, sort]);

  const exportCsv = () => {
    const data = [...((rest.dataSource as readonly T[] | undefined) ?? [])];
    const idx = sort ? sortable.findIndex((c, i) => columnKey(c, i) === sort.key) : -1;
    const ordered = idx >= 0 ? sortRows(data, accessorOf(sortable[idx]), sort!.order) : data;
    const blob = new Blob([toCsv(ordered, sortable)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${exportName}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      {exportName && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
          <Tooltip title="Выгрузить строки в текущем порядке сортировки">
            <Button size="small" type="text" icon={<DownloadOutlined />} onClick={exportCsv}>CSV</Button>
          </Tooltip>
        </div>
      )}
      <Table<T>
        {...rest}
        columns={controlled}
        onChange={(pagination, filters, sorter, extra) => {
          const s = (Array.isArray(sorter) ? sorter[0] : sorter) as SorterResult<T>;
          const next = s?.order && s.columnKey !== undefined ? { key: String(s.columnKey), order: s.order } : null;
          setSort(next);
          saveSort(tableKey, next);
          onChange?.(pagination, filters, sorter, extra);
        }}
      />
    </>
  );
}

export default AppTable;
