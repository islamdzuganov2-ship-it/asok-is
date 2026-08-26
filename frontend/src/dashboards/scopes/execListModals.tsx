/**
 * execListModals.tsx — две списковые модалки управленческого дашборда: «меры на одобрение»
 * и «все системы».
 *
 * Вынесены из ExecScope, чтобы скоуп остался про состояние, а не про таблицы. Данные и
 * обработчики приходят пропсами: модалки ничего не знают о том, кто их открыл.
 */
import React from 'react';
import { Modal, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { ExecSystemInsight } from '../../data/mockDashboards';
import type { Proposal } from '../../store/slices/governanceSlice';
import { ragToken, solidTagStyle, critTagStyle } from '../../theme/ragPalette';
import { numericColumn, sorterFor } from '../../theme/table';
import { parseRuDate } from '../../utils/dates';

const { Text } = Typography;

/** Ранг критичности для явной сортировки столбца — не алфавитный. */
const CRITICALITY_ORDER: Record<string, number> = {
  'MISSION CRITICAL': 0, 'BUSINESS CRITICAL': 1, 'BUSINESS OPERATIONAL': 2,
};

interface Props {
  pendingOpen: boolean;
  onClosePending: () => void;
  pendingProposals: Proposal[];
  allOpen: boolean;
  onCloseAll: () => void;
  systems: ExecSystemInsight[];
  onPickProposal: (p: Proposal) => void;
  onPickSystem: (s: ExecSystemInsight) => void;
}

export const ExecListModals: React.FC<Props> = ({
  pendingOpen, onClosePending, pendingProposals, allOpen, onCloseAll, systems,
  onPickProposal, onPickSystem,
}) => (
  <>
      <Modal
        open={pendingOpen}
        onCancel={onClosePending}
        footer={null}
        width={620}
        title={`Меры, ожидающие вашего решения (${pendingProposals.length})`}
      >
        {pendingProposals.length === 0 ? (
          <Text type="secondary">Нет мер на одобрение.</Text>
        ) : (
          <Table<Proposal>
            dataSource={[...pendingProposals].sort((a, b) => a.calculatedScore - b.calculatedScore)}
            rowKey="id"
            size="small"
            pagination={{ pageSize: 8, hideOnSinglePage: true }}
            onRow={(rec) => ({ onClick: () => onPickProposal(rec), style: { cursor: 'pointer' } })}
            columns={[
              { title: 'Мера', dataIndex: 'riskTitle', sorter: sorterFor((r: Proposal) => r.riskTitle || r.metricName),
                render: (v: string, r) => v || r.metricName },
              { title: 'ИС', dataIndex: 'systemName', width: 180, sorter: sorterFor((r: Proposal) => r.systemName) },
              numericColumn<Proposal>({ title: '%', dataIndex: 'calculatedScore', width: 70,
                render: (v: number) => <Tag style={solidTagStyle(ragToken(v).strong)}>{v}%</Tag>,
                sorter: (a, b) => a.calculatedScore - b.calculatedScore }),
              { title: 'Срок', dataIndex: 'dueDate', width: 110,
                sorter: sorterFor((r: Proposal) => parseRuDate(r.dueDate)?.getTime() ?? null) },
            ] as ColumnsType<Proposal>}
          />
        )}
      </Modal>
      <Modal
        open={allOpen}
        onCancel={onCloseAll}
        footer={null}
        width={760}
        title={`Все системы — оценка качества (${systems.length})`}
      >
        <Table<ExecSystemInsight>
          dataSource={[...systems].sort((a, b) => a.score - b.score)}
          rowKey="id"
          size="small"
          pagination={{ pageSize: 10, hideOnSinglePage: true }}
          onRow={(rec) => ({ onClick: () => onPickSystem(rec), style: { cursor: 'pointer' } })}
          columns={[
            { title: 'ИС', dataIndex: 'name', sorter: sorterFor((r: ExecSystemInsight) => r.name) },
            {
              title: 'Критичность', dataIndex: 'criticality', width: 180,
              sorter: (a, b) => (CRITICALITY_ORDER[a.criticality] ?? 9) - (CRITICALITY_ORDER[b.criticality] ?? 9),
              render: (v: string) => <Tag style={critTagStyle(v)}>{v}</Tag>,
            },
            numericColumn<ExecSystemInsight>({
              title: 'Балл', dataIndex: 'score', width: 110,
              sorter: (a, b) => a.score - b.score,
              render: (v: number) => <Tag style={solidTagStyle(ragToken(v).strong)}>{v}%</Tag>,
            }),
            { title: 'Просевшая характеристика', dataIndex: 'weakCharacteristic', width: 220,
              sorter: sorterFor((r: ExecSystemInsight) => r.weakCharacteristic) },
          ] as ColumnsType<ExecSystemInsight>}
        />
      </Modal>
  </>
);

export default ExecListModals;
