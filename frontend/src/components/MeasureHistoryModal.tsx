/**
 * MeasureHistoryModal.tsx — аудит правок меры: кто, когда, какое поле, было → стало.
 *
 * Вынесено из MeasureDecisionModal. Записи показываются в обратном порядке (свежие сверху):
 * при разборе меры важнее последнее изменение, а не то, с чего всё начиналось.
 */
import React from 'react';
import { Empty, List, Modal, Space, Tag, Typography } from 'antd';
import { HistoryOutlined } from '@ant-design/icons';
import type { ProposalChange } from '../store/slices/governanceTypes';
import { TYPE } from '../theme/premium';

const { Text } = Typography;

/** Человеческие названия правимых полей меры. */
const FIELD_LABELS: Record<string, string> = {
  riskTitle: 'Название меры',
  rationale: 'Обоснование',
  expectation: 'Ожидаемый эффект',
  owner: 'Ответственный',
  ownerRole: 'Роль ответственного',
  dueDate: 'Срок',
  topComment: 'Комментарий топ-менеджмента',
};

const fmtTime = (iso: string) => new Date(iso).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  history: ProposalChange[];
}

export const MeasureHistoryModal: React.FC<Props> = ({ open, onClose, title, history }) => (
  <Modal
    open={open}
    onCancel={onClose}
    footer={null}
    width={560}
    title={<Space><HistoryOutlined /> История изменений — «{title}»</Space>}
  >
    {history.length === 0 ? (
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Правок ещё не было" />
    ) : (
      <List
        size="small"
        dataSource={[...history].reverse()}
        renderItem={(h) => (
          <List.Item>
            <Space direction="vertical" size={2} style={{ width: '100%' }}>
              <Space wrap size={6}>
                <Tag>{fmtTime(h.at)}</Tag>
                <Text strong style={TYPE.bodySm}>{FIELD_LABELS[h.field] ?? h.field}</Text>
                <Text type="secondary" style={TYPE.caption}>{h.by}</Text>
              </Space>
              <Text style={TYPE.bodySm}>
                <Text delete type="secondary">{h.from || '—'}</Text>
                {' → '}
                <Text strong>{h.to || '—'}</Text>
              </Text>
            </Space>
          </List.Item>
        )}
      />
    )}
  </Modal>
);

export default MeasureHistoryModal;
