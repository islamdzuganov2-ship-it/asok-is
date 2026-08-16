/**
 * LevelHeatmap.tsx — HTML-тепловая карта «ИС × характеристики».
 *
 * Зачем не ECharts: нужна ЛИПКАЯ шапка (названия характеристик сверху) и липкий
 * первый столбец (ИС) — на маленьком мониторе при прокрутке заголовки остаются,
 * а строки систем крутятся. Цвет ячейки берётся из ЕДИНОЙ палитры уровней (как в
 * «бублике»), поэтому «Низкий уровень» = красный и там, и там (согласованность).
 */
import React, { useMemo, useState } from 'react';
import { CaretUpOutlined, CaretDownOutlined } from '@ant-design/icons';
import { LEVEL_COLORS, LEVEL_TAG_COLORS, BRAND, ACCENT } from '../theme/ragPalette';
import { TYPE } from '../theme/premium';

export const BUCKET_LEVEL = [
  'Невозможно измерить',
  'Низкий уровень',
  'Ниже среднего',
  'Средний уровень',
  'Выше среднего',
  'Высокий уровень',
];

// Палитра уровней переехала в theme/ragPalette (UI-09) — она нужна страницам сама по себе,
// без разметки теплокарты. Ре-экспорт оставлен, чтобы не ломать существующие импорты.
export { LEVEL_COLORS, LEVEL_TAG_COLORS } from '../theme/ragPalette';

interface Props {
  xLabels: string[];           // характеристики (полные названия) — шапка
  yLabels: string[];           // системы — строки
  matrix: (number | null)[][]; // matrix[y][x] = bucket 0..5
  charScores?: number[];       // балл характеристики (%) для шапки; -1 = невозможно измерить
  onCharClick?: (char: string, index: number) => void; // клик по характеристике (колонка)
  cellScores?: (number | null)[][]; // балл по каждой ячейке (система × характеристика), %
  onCellClick?: (y: number, x: number) => void;        // клик по конкретной ячейке
  maxHeight?: number;
  cornerContent?: React.ReactNode;   // содержимое левого верхнего угла (напр., фильтр по системе)
}

const levelOf = (p: number) =>
  p < 0 ? 'Невозможно измерить' : BUCKET_LEVEL[p < 21 ? 1 : p < 41 ? 2 : p < 61 ? 3 : p < 81 ? 4 : 5];

/** Фон ячейки/маркера — пастель. */
const scoreColor = (p: number) => LEVEL_COLORS[levelOf(p)];
/** Тот же уровень, но как ТЕКСТ на белом: пастель давала 1.94:1, нужен глубокий тон. */
const scoreTextColor = (p: number) => LEVEL_TAG_COLORS[levelOf(p)];

// Текст ВНУТРИ цветной ячейки: пастель ячеек рассчитана под ТЁМНЫЙ текст во всех темах
// (в т.ч. графит), поэтому здесь фиксированный тёмный тон, а не темизируемый BRAND.ink.
const CELL_INK = '#2B3A4B';

// Короткие однострочные подписи характеристик для ровной шапки (полное имя — в подсказке).
const ABBR: Record<string, string> = {
  'Функциональная пригодность': 'Функц.',
  'Производительность': 'Произв.',
  'Совместимость': 'Совмест.',
  'Удобство использования': 'Удобство',
  'Надёжность': 'Надёжн.',
  'Защищённость': 'Защищ.',
  'Сопровождаемость': 'Сопров.',
  'Переносимость': 'Переност.',
};
const short = (c: string) => ABBR[c] ?? c;

const thBase: React.CSSProperties = {
  position: 'sticky', top: 0, zIndex: 2, background: BRAND.surface,
  fontWeight: 500, fontSize: TYPE.micro.fontSize, color: BRAND.inkSoft,
  padding: '8px', borderBottom: `1px solid ${BRAND.divider}`, textAlign: 'center',
  width: 86, minWidth: 86, whiteSpace: 'nowrap', verticalAlign: 'middle',
};

// ТЗ v19 п.12: сортировка строк (систем) теплокарты — по имени или по любому столбцу
// (характеристике). У LevelHeatmap ровно один потребитель (DashboardPage.tsx) — ExecutiveDashboard
// строит свою тепловую карту отдельной вёрсткой (RagDot-маркеры вместо процентных ячеек), поэтому
// сортировка там реализована параллельно, тем же SortButton (экспортирован специально под это).
export type HeatmapSortState = { col: number | 'name'; dir: 'asc' | 'desc' } | null;
type SortState = HeatmapSortState;

/** Иконка-сортировка — САМА кнопка (не текст заголовка): у характеристик заголовок уже занят
 * переходом к подхарактеристикам (onCharClick), сортировка не должна с ним конкурировать за клик. */
export const SortButton: React.FC<{ active: boolean; dir: 'asc' | 'desc' | undefined; onSort: () => void; label: string }> =
  ({ active, dir, onSort, label }) => (
    <span
      role="button"
      aria-label={label}
      title={label}
      onClick={(e) => { e.stopPropagation(); onSort(); }}
      style={{
        marginLeft: 4, padding: '0 2px', cursor: 'pointer', display: 'inline-block',
        color: active ? ACCENT.slate.color : BRAND.dividerSoft, fontSize: 10,
      }}
    >
      {active && dir === 'asc' ? <CaretUpOutlined /> : <CaretDownOutlined />}
    </span>
  );

const LevelHeatmap: React.FC<Props> = ({
  xLabels, yLabels, matrix, charScores, onCharClick, cellScores, onCellClick, maxHeight = 460, cornerContent,
}) => {
  const [sort, setSort] = useState<SortState>(null);

  const rowOrder = useMemo(() => {
    const idx = yLabels.map((_, i) => i);
    if (!sort) return idx;
    const sign = sort.dir === 'asc' ? 1 : -1;
    if (sort.col === 'name') {
      return idx.sort((a, b) => sign * yLabels[a].localeCompare(yLabels[b], 'ru'));
    }
    const valueOf = (i: number): number | null => {
      const v = cellScores?.[i]?.[sort.col as number];
      return v != null && v >= 0 ? v : (matrix[i]?.[sort.col as number] ?? null);
    };
    return idx.sort((a, b) => {
      const va = valueOf(a), vb = valueOf(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;   // «нет данных» — всегда в конец, по возрастанию и убыванию
      if (vb == null) return -1;
      return sign * (va - vb);
    });
  }, [sort, yLabels, matrix, cellScores]);

  const toggleNameSort = () => setSort((s) =>
    (s?.col === 'name' ? { col: 'name', dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col: 'name', dir: 'asc' }));
  const toggleColSort = (i: number) => setSort((s) =>
    (s?.col === i ? { col: i, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col: i, dir: 'desc' }));

  return (
  <div style={{ maxHeight, overflow: 'auto', border: `1px solid ${BRAND.divider}`, borderRadius: 8 }}>
    <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%' }}>
      <thead>
        <tr>
          <th style={{ ...thBase, left: 0, zIndex: 3, textAlign: 'left', minWidth: 200, paddingLeft: 12 }}>
            {cornerContent ?? (
              <span>
                Система \ характеристика
                <SortButton active={sort?.col === 'name'} dir={sort?.dir} onSort={toggleNameSort} label="Сортировать по названию системы" />
              </span>
            )}
          </th>
          {xLabels.map((c, i) => {
            const sc = charScores?.[i];
            return (
              <th
                key={c}
                style={{ ...thBase, cursor: onCharClick ? 'pointer' : 'default' }}
                title={onCharClick ? `${c} — нажмите для подхарактеристик` : c}
                onClick={onCharClick ? () => onCharClick(c, i) : undefined}
              >
                <div>
                  {short(c)}
                  <SortButton active={sort?.col === i} dir={sort?.dir} onSort={() => toggleColSort(i)} label={`Сортировать по «${c}»`} />
                </div>
                {sc !== undefined && (
                  <div style={{ fontSize: TYPE.micro.fontSize, fontWeight: 500, color: scoreTextColor(sc) }}>
                    {sc < 0 ? 'н/д' : `${sc}%`}
                  </div>
                )}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {rowOrder.map((y) => {
          const sys = yLabels[y];
          return (
          <tr key={sys}>
            <td style={{
              position: 'sticky', left: 0, zIndex: 1, background: BRAND.surface,
              fontSize: TYPE.caption.fontSize, color: BRAND.ink, padding: '4px 12px',
              borderBottom: `1px solid ${BRAND.dividerSoft}`, whiteSpace: 'nowrap',
            }} title={sys}>{sys}</td>
            {xLabels.map((c, x) => {
              const b = matrix[y]?.[x];
              const level = b == null ? null : BUCKET_LEVEL[b];
              const sc = cellScores?.[y]?.[x];
              const label = sc != null ? (sc < 0 ? 'н/д' : `${sc}%`) : '';
              return (
                // ui-audit-ignore UI-05 — зазор мозаики теплокарты: это плотность визуализации,
                // а не отступ макета; сетка 4px разредит карту и сломает чтение цветовых пятен.
                <td key={x} style={{ padding: 2, borderBottom: `1px solid ${BRAND.dividerSoft}` }}>
                  <div
                    onClick={onCellClick ? () => onCellClick(y, x) : undefined}
                    title={`${sys} · ${c}: ${level ?? 'нет данных'}${label ? ` · ${label}` : ''}`}
                    style={{
                      height: 26, borderRadius: 3,
                      background: level ? LEVEL_COLORS[level] : BRAND.dividerSoft,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: TYPE.micro.fontSize, fontWeight: 500, color: CELL_INK,
                      cursor: onCellClick ? 'pointer' : 'default',
                    }}
                  >
                    {label}
                  </div>
                </td>
              );
            })}
          </tr>
          );
        })}
      </tbody>
    </table>
  </div>
  );
};

export default LevelHeatmap;
