/**
 * LevelHeatmap.tsx — HTML-тепловая карта «ИС × характеристики».
 *
 * Зачем не ECharts: нужна ЛИПКАЯ шапка (названия характеристик сверху) и липкий
 * первый столбец (ИС) — на маленьком мониторе при прокрутке заголовки остаются,
 * а строки систем крутятся. Цвет ячейки берётся из ЕДИНОЙ палитры уровней (как в
 * «бублике»), поэтому «Низкий уровень» = красный и там, и там (согласованность).
 */
import React from 'react';

export const BUCKET_LEVEL = [
  'Невозможно измерить',
  'Низкий уровень',
  'Уровень ниже среднего',
  'Средний уровень',
  'Уровень выше среднего',
  'Высокий уровень',
];

// Пастельная диверг. палитра, согласованная с приглушённой RAG (шалфей→золото→терракот).
export const LEVEL_COLORS: Record<string, string> = {
  'Высокий уровень': '#7FA98C',        // мягкий шалфей
  'Уровень выше среднего': '#A6C29A',  // светлый шалфей
  'Средний уровень': '#D8BE7E',        // приглушённое золото
  'Уровень ниже среднего': '#D9A47E',  // мягкая глина
  'Низкий уровень': '#CC8B81',         // приглушённый терракот
  'Невозможно измерить': '#AAB0B6',    // спокойный серый
};

interface Props {
  xLabels: string[];           // характеристики (полные названия) — шапка
  yLabels: string[];           // системы — строки
  matrix: (number | null)[][]; // matrix[y][x] = bucket 0..5
  maxHeight?: number;
}

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
  padding: '8px 6px', borderBottom: '1px solid #E8EAED', textAlign: 'center',
  width: 86, minWidth: 86, whiteSpace: 'nowrap', verticalAlign: 'middle',
};

const LevelHeatmap: React.FC<Props> = ({ xLabels, yLabels, matrix, maxHeight = 460 }) => (
  <div style={{ maxHeight, overflow: 'auto', border: '1px solid #E8EAED', borderRadius: 8 }}>
    <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%' }}>
      <thead>
        <tr>
          <th style={{ ...thBase, left: 0, zIndex: 3, textAlign: 'left', minWidth: 180, paddingLeft: 12 }}>
            Система \ характеристика
          </th>
          {xLabels.map((c) => (
            <th key={c} style={thBase} title={c}>{short(c)}</th>
          ))}
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
              return (
                <td key={x} style={{ padding: 2, borderBottom: '1px solid #F0F1F3' }}>
                  <div
                    title={level ? `${sys} · ${c}: ${level}` : `${sys} · ${c}: нет данных`}
                    style={{
                      height: 24, borderRadius: 3,
                      background: level ? LEVEL_COLORS[level] : '#F1F2F3',
                    }}
                  />
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
