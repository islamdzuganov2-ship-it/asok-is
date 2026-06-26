/**
 * ActionInsightModal.tsx — компактное модальное окно топ-менеджмента (R1.5 ТЗ v9).
 * По клику на проблемную ИС показывает «нативно понятно»:
 *   • Кто виноват (владелец/ответственный)
 *   • С кого спрашивать (эскалация)
 *   • Рекомендуемые действия
 *   • Меры менеджера по качеству, ожидающие одобрения (с пояснением «что ждут и почему»)
 * Минимум текста и цвета, спокойные тона.
 */
import React from 'react';
import { Modal, Typography, Tag, Divider, List, Button, Empty, Space, Tooltip } from 'antd';
import {
  UserOutlined, RiseOutlined, BulbOutlined, CheckOutlined, CloseOutlined, ClockCircleOutlined,
} from '@ant-design/icons';
import { useDispatch, useSelector, shallowEqual } from 'react-redux';
import { RootState } from '../store';
import { approveProposal, rejectProposal } from '../store/slices/governanceSlice';
import { ragToken } from '../theme/ragPalette';
import type { ExecSystemInsight } from '../data/mockDashboards';

const { Title, Text, Paragraph } = Typography;

interface Props {
  open: boolean;
  system: ExecSystemInsight | null;
  onClose: () => void;
}

const Block: React.FC<{ icon: React.ReactNode; title: string; children: React.ReactNode }> = ({
  icon, title, children,
}) => (
  <div style={{ marginBottom: 14 }}>
    <Text type="secondary" style={{ fontSize: 12 }}>
      {icon} {title}
    </Text>
    <div style={{ marginTop: 2 }}>{children}</div>
  </div>
);

export const ActionInsightModal: React.FC<Props> = ({ open, system, onClose }) => {
  const dispatch = useDispatch();
  const fullName = useSelector((s: RootState) => s.auth.fullName) || 'Топ-менеджмент';
  const proposals = useSelector(
    (s: RootState) => s.governance.proposals.filter((p) => p.systemName === system?.name),
    shallowEqual,
  );

  if (!system) return null;
  const tok = ragToken(system.score);
  const pending = proposals.filter((p) => p.status === 'PENDING_APPROVAL');

  return (
    <Modal open={open} onCancel={onClose} footer={null} width={520} title={null}>
      <Space align="center" style={{ marginBottom: 4 }}>
        <Title level={5} style={{ margin: 0 }}>{system.name}</Title>
        <Tag color={tok.color} style={{ color: '#fff', border: 'none' }}>
          {system.score}% · {tok.label}
        </Tag>
      </Space>
      <Paragraph type="secondary" style={{ fontSize: 13, marginTop: 8 }}>
        {system.aiSummary}
      </Paragraph>

      <Block icon={<BulbOutlined />} title="Рекомендация">
        <Text strong>{system.recommendation}</Text>
      </Block>

      <Space size={32} style={{ display: 'flex', flexWrap: 'wrap' }}>
        <Block icon={<UserOutlined />} title="Кто отвечает">
          <Text>{system.owner}</Text>
        </Block>
        <Block icon={<RiseOutlined />} title="С кого спрашивать">
          <Text>{system.escalateTo}</Text>
        </Block>
      </Space>

      <Block icon={<BulbOutlined />} title="Рекомендуемые действия">
        <List
          size="small"
          dataSource={system.actions}
          split={false}
          renderItem={(a, i) => (
            <List.Item style={{ padding: '2px 0', border: 'none' }}>
              <Text>{i + 1}. {a}</Text>
            </List.Item>
          )}
        />
      </Block>

      <Divider style={{ margin: '12px 0' }} />

      <Text type="secondary" style={{ fontSize: 12 }}>
        <ClockCircleOutlined /> Меры менеджера по качеству, ожидающие вашего решения
      </Text>

      {pending.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="Нет мер на одобрение"
          style={{ margin: '8px 0' }}
        />
      ) : (
        <List
          style={{ marginTop: 8 }}
          dataSource={pending}
          renderItem={(p) => (
            <List.Item
              style={{ display: 'block', background: tok.soft, borderRadius: 8, padding: 12, marginBottom: 8, border: `1px solid ${tok.border}` }}
            >
              <Text strong>{p.riskTitle || p.metricName}</Text>
              <Paragraph style={{ fontSize: 13, margin: '4px 0' }}>{p.expectation}</Paragraph>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Обоснование: {p.rationale}
              </Text>
              <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                <Tooltip title="Одобрить меру">
                  <Button
                    size="small" type="primary" icon={<CheckOutlined />}
                    style={{ background: ragToken(85).color, borderColor: ragToken(85).color }}
                    onClick={() => dispatch(approveProposal({ id: p.id, by: fullName }))}
                  >
                    Одобрить
                  </Button>
                </Tooltip>
                <Button
                  size="small" icon={<CloseOutlined />}
                  onClick={() => dispatch(rejectProposal({ id: p.id, by: fullName }))}
                >
                  Отклонить
                </Button>
              </div>
            </List.Item>
          )}
        />
      )}
    </Modal>
  );
};

export default ActionInsightModal;
