/**
 * AiConformanceModal.tsx — отчёт соответствия базовым значениям (ГОСТ Р 59898-2021, критерий
 * приёмки 7) и условия испытаний E3 (набор, выбросы, паритет сред, экспертная группа).
 * Вынесено из AiAssessmentPage.tsx (потолок размера модуля).
 */
import React from 'react';
import { Alert, Modal, Space, Tag, Typography } from 'antd';
import { FileDoneOutlined } from '@ant-design/icons';
import AppTable from '../../components/AppTable';
import { numericColumn, numericText, sorterFor } from '../../theme/table';
import { VERDICT_TAG, type ConfReport, type ConfRow } from './aiModel';
import type { TestConditions } from './aiE3Api';

const { Text } = Typography;

interface Props {
  report: (ConfReport & { test_conditions?: TestConditions | null }) | null;
  open: boolean;
  onClose: () => void;
}

export const AiConformanceModal: React.FC<Props> = ({ report, open, onClose }) => (
  <>
    <Modal
      title={<span><FileDoneOutlined /> Отчёт соответствия базовым значениям</span>}
      open={open} onCancel={onClose} footer={null} width={860}
    >
      {report && (
        <Space direction="vertical" style={{ width: '100%' }} size={10}>
          <Space size="large" wrap>
            <Text strong style={numericText}>Q = {report.q != null ? report.q.toFixed(3) : '—'}</Text>
            <Tag>{report.level}</Tag>
            <Tag color="green">В допуске: {report.conformant_count}</Tag>
            <Tag color="red">Вне допуска: {report.nonconformant_count}</Tag>
            <Tag>Без эталона: {report.no_baseline_count}</Tag>
          </Space>
          <AppTable<ConfRow> tableKey="ai-conformance" exportName="otchet-sootvetstviya"
            dataSource={report.rows} rowKey={(r) => `${r.characteristic}|${r.subcharacteristic}`}
            size="small" bordered pagination={false} scroll={{ y: 400 }}
            columns={[
              { title: 'Характеристика', dataIndex: 'characteristic', width: 180, ellipsis: true, sorter: sorterFor((r: ConfRow) => r.characteristic) },
              { title: 'Субхарактеристика', dataIndex: 'subcharacteristic', ellipsis: true, sorter: sorterFor((r: ConfRow) => r.subcharacteristic) },
              { title: 'Значение', dataIndex: 'raw_value', width: 90, sorter: sorterFor((r: any) => r.raw_value), render: (v: number | null) => v == null ? '—' : v.toFixed(3) },
              numericColumn({ title: 'Эталон', dataIndex: 'baseline', width: 80, sorter: sorterFor((r: any) => r.baseline), render: (v: number | null) => v == null ? '—' : v }),
              numericColumn({ title: 'ε⁻/ε⁺', key: 'tol', width: 90, sorter: sorterFor((r: any) => r.tol_low), render: (_: unknown, r: any) => r.baseline == null ? '—' : `${r.tol_low ?? 0}/${r.tol_high ?? 0}` }),
              numericColumn({ title: 'X', dataIndex: 'normalized_x', width: 70, sorter: sorterFor((r: any) => r.normalized_x), render: (v: number | null) => v == null ? '—' : v.toFixed(3) }),
              { title: 'Вердикт', dataIndex: 'verdict', width: 150, sorter: sorterFor((r: ConfRow) => r.verdict), render: (v: string) => <Tag color={VERDICT_TAG[v]}>{v}</Tag> },
            ]}
          />
        </Space>
      )}
    </Modal>
  </>
);

export default AiConformanceModal;
