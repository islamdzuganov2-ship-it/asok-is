/**
 * assessmentColumns.tsx — колонки двух таблиц рабочего места оценки: обзор периодов и
 * результат расчёта по подхарактеристикам.
 *
 * Вынесено из NewAssessmentPage. Обзор периодов — фабрика: строке нужен переход к периоду по
 * клику, а само состояние выбора остаётся на странице.
 */
import React from 'react';
import { Button, Progress, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { PeriodSummary } from '../../store/api/apiSlice';
import { numericColumn, sorterFor } from '../../theme/table';
import { TYPE } from '../../theme/premium';

const { Text } = Typography;

const LEVEL_COLOR: Record<string, string> = {
    'Высокий уровень': 'green',
    'Выше среднего': 'cyan',
    'Средний уровень': 'gold',
    'Ниже среднего': 'orange',
    'Низкий уровень': 'red',
    'Невозможно измерить': 'default',
};
// Порядок значимости уровня для сортировки — от лучшего к худшему, не алфавитный.
const LEVEL_RANK: Record<string, number> = Object.fromEntries(
    Object.keys(LEVEL_COLOR).map((k, i) => [k, i]),
);


/** Строка результата расчёта: подхарактеристика, входы A/B, X и уровень качества. */
export interface ResultRow {
  key: string;
  characteristic: string;
  subcharacteristic: string;
  val_a: number | null;
  val_b: number | null;
  x: number | null;
  level: string | null;
  comment: string;
}

/** Колонки обзора периодов.  открывает период по клику на строке действия. */
/**  — уже открытый период: его строка подсвечивается кнопкой «Выбрана». */
export function makeOverviewColumns(
  onOpen: (periodId: string) => void,
  activeId: string | undefined,
): ColumnsType<PeriodSummary> {
  return [
      { title: 'Период', dataIndex: 'period', width: 130, sorter: sorterFor((r: PeriodSummary) => r.period) },
      {
          // ui-audit-ignore UI-02 — в колонке полоса Progress, а не число: она занимает ширину
          // колонки, выравнивание вправо неприменимо.
          title: 'Заполнено', key: 'filled', width: 200,
          sorter: sorterFor((r: PeriodSummary) => r.filled / (r.total || 1)),
          render: (_: unknown, rec) => (
              <Progress
                  percent={Math.round((rec.filled / rec.total) * 100)}
                  size="small"
                  status={rec.complete ? 'success' : 'active'}
                  format={() => `${rec.filled}/${rec.total}`}
              />
          ),
      },
      {
          title: 'Статус', key: 'status', width: 160,
          sorter: sorterFor((r: PeriodSummary) => (r.complete ? 2 : r.filled > 0 ? 1 : 0)),
          render: (_: unknown, rec) => (
              rec.complete
                  ? <Tag color="green">Завершена</Tag>
                  : rec.filled > 0
                      ? <Tag color="gold">Заполняется</Tag>
                      : <Tag>Черновик</Tag>
          ),
      },
      {
          title: '', key: 'action', width: 130,
          render: (_: unknown, rec) => (
              <Button
                  size="small"
                  type={rec.id === activeId ? 'primary' : 'default'}
                  onClick={() => onOpen(rec.id)}
              >
                  {rec.id === activeId ? 'Выбрана' : 'Открыть'}
              </Button>
          ),
      },
  ];
}

/** Колонки результата расчёта — от состояния страницы не зависят. */
  export const resultColumns: ColumnsType<ResultRow> = [
      { title: 'Характеристика', dataIndex: 'characteristic', width: 220, sorter: sorterFor((r: ResultRow) => r.characteristic) },
      { title: 'Подхарактеристика', dataIndex: 'subcharacteristic', width: 230, sorter: sorterFor((r: ResultRow) => r.subcharacteristic) },
      numericColumn({ title: 'A', dataIndex: 'val_a', width: 70, sorter: sorterFor((r: ResultRow) => r.val_a), render: (v: number | null) => (v ?? '—') }),
      numericColumn({ title: 'B', dataIndex: 'val_b', width: 70, sorter: sorterFor((r: ResultRow) => r.val_b), render: (v: number | null) => (v ?? '—') }),
      numericColumn({
          title: 'X', dataIndex: 'x', width: 80,
          sorter: sorterFor((r: ResultRow) => r.x),
          render: (x: number | null) => (x != null ? <Text strong>{x.toFixed(2)}</Text> : <Text type="secondary">—</Text>),
      }),
      {
          title: 'Уровень', dataIndex: 'level', width: 180,
          sorter: sorterFor((r: ResultRow) => LEVEL_RANK[r.level ?? ''] ?? -1),
          render: (level: string | null) => (
              level
                  ? <Tag color={LEVEL_COLOR[level] ?? 'default'}>{level}</Tag>
                  : <Tag color="default">Не заполнено</Tag>
          ),
      },
      {
          title: 'Комментарий', dataIndex: 'comment',
          sorter: sorterFor((r: ResultRow) => r.comment),
          render: (c: string) => (c ? <Text style={{ fontSize: TYPE.caption.fontSize }}>{c}</Text> : <Text type="secondary">—</Text>),
      },
  ];
