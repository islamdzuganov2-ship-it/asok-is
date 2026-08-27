/**
 * reportColumns.tsx — колонки отчётных таблиц периода: качество, риски, недостатки, план.
 *
 * Вынесено из ExcelReportsPage вместе с редактируемой ячейкой комментария. Колонки реестра мер
 * остались на странице: им нужны решения по мерам (dispatch, права ЛПР) — это уже не подача
 * данных, а действие.
 *
 * Фабрика, а не константы: ячейке комментария нужен id периода — она пишет прямо в оценку.
 */
import React, { useState } from 'react';
import { Button, Input, Space, Tag, Tooltip, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { message } from '../../theme/appMessage';
import { EditableMetric, useSaveAssessmentMetricsMutation } from '../../store/api/apiSlice';
import type { ProposalStatus } from '../../store/slices/governanceTypes';
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

const reportCardStyle: React.CSSProperties = {
    border: '1px solid #d9e2f3',
    borderRadius: 4,
};

const CommentCell: React.FC<{ row: EditableMetric; periodId: string }> = ({ row, periodId }) => {
    const [value, setValue] = useState(row.expert_comment || '');
    const [save, { isLoading }] = useSaveAssessmentMetricsMutation();
    const dirty = (value || '') !== (row.expert_comment || '');
    const handleSave = async () => {
        try {
            await save({ id: periodId, metrics: [{ ...row, expert_comment: value }] }).unwrap();
            message.success('Комментарий сохранён');
        } catch {
            message.error('Не удалось сохранить комментарий');
        }
    };
    return (
        <Space.Compact style={{ width: '100%' }}>
            <Input
                size="small"
                value={value}
                placeholder="Комментарий / корректировка"
                onChange={(e) => setValue(e.target.value)}
                onPressEnter={handleSave}
            />
            <Button size="small" type="primary" loading={isLoading} disabled={!dirty} onClick={handleSave}>
                OK
            </Button>
        </Space.Compact>
    );
};

/** Колонки отчётных таблиц.  нужен редактируемой ячейке комментария. */
interface Options {
  activePeriodId: string | undefined;
  /** Статус меры по нормализованному названию характеристики — считает страница. */
  measureStatusByChar: Map<string, ProposalStatus>;
  normChar: (s: string) => string;
  statusTag: Record<ProposalStatus, { color: string; label: string }>;
}

/** Колонки отчётных таблиц периода. */
export function makeReportColumns({ activePeriodId, measureStatusByChar, normChar, statusTag }: Options) {
  const qualityColumns: ColumnsType<EditableMetric> = [
      { title: 'Характеристика', dataIndex: 'characteristic', width: 220, sorter: sorterFor((r: EditableMetric) => r.characteristic) },
      { title: 'Подхарактеристика', dataIndex: 'subcharacteristic', width: 230, sorter: sorterFor((r: EditableMetric) => r.subcharacteristic) },
      numericColumn({ title: 'A', dataIndex: 'val_a', width: 70, sorter: sorterFor((r: EditableMetric) => r.val_a), render: (v: number | null) => (v ?? '—') }),
      numericColumn({ title: 'B', dataIndex: 'val_b', width: 70, sorter: sorterFor((r: EditableMetric) => r.val_b), render: (v: number | null) => (v ?? '—') }),
      numericColumn({
          title: 'X', dataIndex: 'calculatedX', width: 80,
          sorter: sorterFor((r: EditableMetric) => r.calculatedX),
          render: (x: number | null | undefined) =>
              (x != null ? <Text strong>{x.toFixed(2)}</Text> : <Text type="secondary">—</Text>),
      }),
      {
          title: 'Уровень', dataIndex: 'qualityLevel', width: 170,
          sorter: sorterFor((r: EditableMetric) => LEVEL_RANK[r.qualityLevel ?? ''] ?? -1),
          render: (level: string | null | undefined) =>
              (level ? <Tag color={LEVEL_COLOR[level] ?? 'default'}>{level}</Tag> : <Text type="secondary">—</Text>),
      },
      {
          title: 'Комментарий', dataIndex: 'expert_comment', width: 280,
          sorter: sorterFor((r: EditableMetric) => r.expert_comment),
          render: (_: unknown, row) => (activePeriodId ? <CommentCell row={row} periodId={activePeriodId} /> : null),
      },
  ];

  const risksColumns: ColumnsType<any> = [
      { title: 'Характеристика', dataIndex: 'characteristic', width: 220, sorter: sorterFor((r: any) => r.characteristic) },
      { title: 'Подхарактеристика', dataIndex: 'subcharacteristic', width: 220, sorter: sorterFor((r: any) => r.subcharacteristic) },
      { title: 'Описание риска', dataIndex: 'risk_description', sorter: sorterFor((r: any) => r.risk_description) },
      { title: 'Последствие риска', dataIndex: 'risk_consequence', sorter: sorterFor((r: any) => r.risk_consequence) },
      { title: 'Меры минимизации', dataIndex: 'mitigation_measures', sorter: sorterFor((r: any) => r.mitigation_measures) },
  ];

  const defectsColumns: ColumnsType<any> = [
      { title: 'N', dataIndex: 'id', width: 70, sorter: sorterFor((r: any) => r.id) },
      { title: 'Характеристика качества', dataIndex: 'characteristic', width: 240, sorter: sorterFor((r: any) => r.characteristic) },
      { title: 'Цифровой показатель', dataIndex: 'digital_metric', width: 160, sorter: sorterFor((r: any) => r.digital_metric) },
      { title: 'Уровень качества', dataIndex: 'quality_metric_level', width: 180, sorter: sorterFor((r: any) => LEVEL_RANK[r.quality_metric_level ?? ''] ?? -1) },
      { title: 'Описание недостатка ИС', dataIndex: 'defect_description', sorter: sorterFor((r: any) => r.defect_description) },
  ];

  const planColumns: ColumnsType<any> = [
      { title: 'N', dataIndex: 'id', width: 70, sorter: sorterFor((r: any) => r.id) },
      { title: 'Характеристика', dataIndex: 'characteristic', width: 220, sorter: sorterFor((r: any) => r.characteristic) },
      { title: 'Подхарактеристика', dataIndex: 'subcharacteristic', width: 220, sorter: sorterFor((r: any) => r.subcharacteristic) },
      { title: 'Описание задачи', dataIndex: 'task_description', sorter: sorterFor((r: any) => r.task_description) },
      { title: 'ВНД банка', dataIndex: 'internal_document', width: 160, sorter: sorterFor((r: any) => r.internal_document) },
      { title: 'Ответственный', dataIndex: 'assignee_fio', width: 180, sorter: sorterFor((r: any) => r.assignee_fio) },
      { title: 'Срок', dataIndex: 'deadline', width: 130, sorter: sorterFor((r: any) => r.deadline) },
      {
          title: 'Статус меры', key: 'measureStatus', width: 150,
          sorter: sorterFor((r: any) => measureStatusByChar.get(normChar(r.characteristic || '')) ?? ''),
          render: (_: unknown, row: any) => {
              const st = measureStatusByChar.get(normChar(row.characteristic || ''));
              return st
                  ? <Tag color={statusTag[st].color}>{statusTag[st].label}</Tag>
                  : <Text type="secondary" style={{ fontSize: TYPE.caption.fontSize }}>нет меры</Text>;
          },
      },
  ];
  return { qualityColumns, risksColumns, defectsColumns, planColumns };
}
