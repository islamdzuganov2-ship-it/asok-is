/**
 * assessmentMetricColumns.tsx — колонки таблицы правки метрик оценки.
 *
 * Вынесено из AssessmentCorrectionPanel: восемьдесят строк описания колонок с редакторами
 * (A, B, «невозможно измерить», комментарий) читались тяжелее, чем вся остальная логика панели.
 *
 * Фабрика, а не константа: колонкам нужен колбэк правки строки и карта несохранённых правок,
 * а само состояние правки остаётся в панели — здесь только подача.
 */
import React from 'react';
import { Checkbox, Input, InputNumber, Tag, Tooltip, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { EditableMetric } from '../store/api/apiSlice';
import { numericColumn, sorterFor } from '../theme/table';
import { TYPE } from '../theme/premium';

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

interface Options {
  /** Применить правку одной ячейки к строке черновика. */
  patchRow: (id: string, patch: Partial<EditableMetric>) => void;
  /** Несохранённые правки по id строки — по ним рисуется маркер «изменено». */
  edits: Record<string, unknown>;
  /** Период закрыт: значения только для чтения, редакторы блокируются. */
  locked: boolean;
}

export function makeMetricColumns({ patchRow, edits, locked }: Options): ColumnsType<EditableMetric> {
  return [
    { title: 'Характеристика', dataIndex: 'characteristic', width: 200, ellipsis: true,
      sorter: sorterFor((r: EditableMetric) => r.characteristic) },
    { title: 'Подхарактеристика', dataIndex: 'subcharacteristic', width: 220, ellipsis: true,
      sorter: sorterFor((r: EditableMetric) => r.subcharacteristic) },
    {
      title: <Tooltip title="A — фактически достигнутое значение (числитель)">A (факт)</Tooltip>,
      dataIndex: 'val_a', width: 110,
      sorter: sorterFor((r: EditableMetric) => r.val_a),
      render: (_, rec) => (
        <InputNumber
          size="small" min={0} precision={2} style={{ width: '100%' }}
          value={rec.val_a ?? undefined}
          disabled={locked || rec.unmeasurable}
          onChange={(v) => patchRow(rec.id, { val_a: v as number | null })}
        />
      ),
    },
    {
      title: <Tooltip title="B — база сравнения (знаменатель), B > 0">B (база)</Tooltip>,
      dataIndex: 'val_b', width: 110,
      sorter: sorterFor((r: EditableMetric) => r.val_b),
      render: (_, rec) => (
        <InputNumber
          size="small" min={0} precision={2} style={{ width: '100%' }}
          value={rec.val_b ?? undefined}
          status={rec.val_b === 0 && !rec.unmeasurable ? 'error' : ''}
          disabled={locked || rec.unmeasurable}
          onChange={(v) => patchRow(rec.id, { val_b: v as number | null })}
        />
      ),
    },
    {
      title: <Tooltip title="Нет возможности собрать данные. Требует комментарий с причиной.">Невозм. изм.</Tooltip>,
      dataIndex: 'unmeasurable', width: 96, align: 'center',
      sorter: sorterFor((r: EditableMetric) => (r.unmeasurable ? 1 : 0)),
      render: (_, rec) => (
        <Checkbox
          checked={!!rec.unmeasurable}
          disabled={locked}
          onChange={(e) => patchRow(rec.id, e.target.checked
            ? { unmeasurable: true, val_a: null, val_b: null }
            : { unmeasurable: false })}
        />
      ),
    },
    {
      title: <Tooltip title="Пояснение к оценке. Обязателен, если отмечено «Невозм. изм.» — укажите причину отсутствия данных.">Комментарий</Tooltip>,
      dataIndex: 'expert_comment', width: 240,
      sorter: sorterFor((r: EditableMetric) => r.expert_comment),
      render: (_, rec) => (
        <Input
          size="small"
          value={rec.expert_comment}
          disabled={locked}
          status={rec.unmeasurable && !(rec.expert_comment || '').trim() ? 'error' : ''}
          placeholder={rec.unmeasurable ? 'Причина: почему нельзя измерить (обязательно)' : 'Комментарий'}
          onChange={(e) => patchRow(rec.id, { expert_comment: e.target.value })}
        />
      ),
    },
    numericColumn({
      title: 'X', dataIndex: 'calculatedX', width: 74,
      sorter: sorterFor((r: EditableMetric) => r.calculatedX),
      render: (x: number | null | undefined) =>
        (x != null ? <Text strong>{x.toFixed(2)}</Text> : <Text type="secondary">—</Text>),
    }),
    {
      title: 'Уровень', dataIndex: 'qualityLevel', width: 170,
      sorter: sorterFor((r: EditableMetric) => LEVEL_RANK[r.qualityLevel ?? ''] ?? -1),
      render: (level: string | null | undefined) => (level
        ? <Tag color={LEVEL_COLOR[level] ?? 'default'} style={{ fontSize: TYPE.micro.fontSize }}>{level}</Tag>
        : <Text type="secondary">—</Text>),
    },
    {
      title: 'Изм.', key: 'dirty', width: 48, align: 'center',
      sorter: sorterFor((r: EditableMetric) => (edits[r.id] ? 1 : 0)),
      render: (_, rec) => (edits[rec.id] ? <Tag color="orange" style={{ fontSize: TYPE.micro.fontSize }}>●</Tag> : null),
    },
  ];
}
