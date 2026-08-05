/**
 * LevelHeatmap.tsx — HTML-тепловая карта «ИС × характеристики».
 *
 * Зачем не ECharts: нужна ЛИПКАЯ шапка (названия характеристик сверху) и липкий
 * первый столбец (ИС) — на маленьком мониторе при прокрутке заголовки остаются,
 * а строки систем крутятся. Цвет ячейки берётся из ЕДИНОЙ палитры уровней (как в
 * «бублике»), поэтому «Низкий уровень» = красный и там, и там (согласованность).
 */
import React from 'react';
import { LEVEL_COLORS, LEVEL_TAG_COLORS } from '../theme/ragPalette';

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
  position: 'sticky', top: 0, zIndex: 2, background: '#fff',
  fontWeight: 500, fontSize: 11, color: '#5B6675',
  padding: '8px', borderBottom: '1px solid #E8EAED', textAlign: 'center',
  width: 86, minWidth: 86, whiteSpace: 'nowrap', verticalAlign: 'middle',
};

const LevelHeatmap: React.FC<Props> = ({
  xLabels, yLabels, matrix, charScores, onCharClick, cellScores, onCellClick, maxHeight = 460, cornerContent,
}) => (
  <div style={{ maxHeight, overflow: 'auto', border: '1px solid #E8EAED', borderRadius: 8 }}>
    <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%' }}>
      <thead>
        <tr>
          <th style={{ ...thBase, left: 0, zIndex: 3, textAlign: 'left', minWidth: 200, paddingLeft: 12 }}>
            {cornerContent ?? 'Система \\ характеристика'}
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
                <div>{short(c)}</div>
                {sc !== undefined && (
                  <div style={{ fontSize: 11, fontWeight: 500, color: scoreTextColor(sc) }}>
                    {sc < 0 ? 'н/д' : `${sc}%`}
                  </div>
                )}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {yLabels.map((sys, y) => (
          <tr key={sys}>
            <td style={{
              position: 'sticky', left: 0, zIndex: 1, background: '#fff',
              fontSize: 12, color: '#2B3A4B', padding: '4px 12px',
              borderBottom: '1px solid #F0F1F3', whiteSpace: 'nowrap',
            }} title={sys}>{sys}</td>
            {xLabels.map((c, x) => {
              const b = matrix[y]?.[x];
              const level = b == null ? null : BUCKET_LEVEL[b];
              const sc = cellScores?.[y]?.[x];
              const label = sc != null ? (sc < 0 ? 'н/д' : `${sc}%`) : '';
              return (
                // ui-audit-ignore UI-05 — зазор мозаики теплокарты: это плотность визуализации,
                // а не отступ макета; сетка 4px разредит карту и сломает чтение цветовых пятен.
                <td key={x} style={{ padding: 2, borderBottom: '1px solid #F0F1F3' }}>
                  <div
                    onClick={onCellClick ? () => onCellClick(y, x) : undefined}
                    title={`${sys} · ${c}: ${level ?? 'нет данных'}${label ? ` · ${label}` : ''}`}
                    style={{
                      height: 26, borderRadius: 3,
                      background: level ? LEVEL_COLORS[level] : '#F1F2F3',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 11, fontWeight: 500, color: '#2B3A4B',
                      cursor: onCellClick ? 'pointer' : 'default',
                    }}
                  >
                    {label}
                  </div>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

export default LevelHeatmap;
