/**
 * MeasureDecisionModal.tsx — карточка меры качества с принятием решения.
 *
 * Открывается по клику на меру (в управленческом дашборде / реестре). Показывает
 * полный контекст меры и, если она ожидает решения, даёт топ-менеджменту
 * одобрить/отклонить с обязательной возможностью оставить комментарий-обоснование.
 * Для уже решённых мер показывает решение и комментарий ЛПР (read-only).
 */
import React, { useEffect, useState } from 'react';
import { Modal, Typography, Tag, Input, Button, Space, Divider, message } from 'antd';
import { CheckOutlined, CloseOutlined } from '@ant-design/icons';
import { useDispatch, useSelector } from 'react-redux';
import { RootState } from '../store';
import { approveProposal, rejectProposal, setExecution, updateProposalMeta, type Proposal, type ProposalStatus } from '../store/slices/governanceSlice';
import { ragToken } from '../theme/ragPalette';

const { Text, Paragraph } = Typography;

const STATUS_TAG: Record<ProposalStatus, { color: string; label: string }> = {
  PENDING_APPROVAL: { color: 'gold', label: 'Ожидает решения' },
  APPROVED: { color: 'green', label: 'Одобрена' },
  REJECTED: { color: 'red', label: 'Отклонена' },
};

interface Props {
  open: boolean;
  proposal: Proposal | null;
  onClose: () => void;
}

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div style={{ marginBottom: 10 }}>
    <Text type="secondary" style={{ fontSize: 12 }}>{label}</Text>
    <div>{children}</div>
  </div>
);

export const MeasureDecisionModal: React.FC<Props> = ({ open, proposal, onClose }) => {
  const dispatch = useDispatch();
  const fullName = useSelector((s: RootState) => s.auth.fullName) || 'Топ-менеджмент';
  const role = useSelector((s: RootState) => s.auth.role) || '';
  const [comment, setComment] = useState('');
  const [execComment, setExecComment] = useState('');
  // Редактируемые топ-менеджментом поля (ответственный/срок) до принятия решения.
  const [editOwner, setEditOwner] = useState('');
  const [editOwnerRole, setEditOwnerRole] = useState('');
  const [editDue, setEditDue] = useState('');

  useEffect(() => {
    setComment(''); setExecComment('');
    setEditOwner(proposal?.owner || '');
    setEditOwnerRole(proposal?.ownerRole || '');
    setEditDue(proposal?.dueDate || '');
  }, [proposal?.id]);

  if (!proposal) return null;
  const isPending = proposal.status === 'PENDING_APPROVAL';
  const isApproved = proposal.status === 'APPROVED';
  // Отчёт о выполнении — зона ответственности ТОЛЬКО менеджера по качеству.
  const canReportExecution = role === 'QUALITY_MANAGER';
  // Менять ответственного/срок перед решением может топ-менеджмент (ЛПР).
  const canEditMeta = ['ADMIN', 'CTO', 'CEO', 'CIO', 'EXECUTIVE'].includes(role);
  const st = STATUS_TAG[proposal.status];
  const tok = ragToken(proposal.calculatedScore);

  const decide = (action: typeof approveProposal | typeof rejectProposal) => {
    if (isPending && canEditMeta) {
      dispatch(updateProposalMeta({
        id: proposal.id,
        owner: editOwner.trim(),
        ownerRole: editOwnerRole.trim(),
        dueDate: editDue.trim() || undefined,
      }));
    }
    dispatch(action({ id: proposal.id, by: fullName, comment: comment.trim() || undefined }));
    onClose();
  };

  const reportExecution = (statusValue: 'DONE' | 'NOT_DONE') => {
    if (!execComment.trim()) {
      message.error('Комментарий обязателен: укажите, как выполнено или почему не выполнено');
      return;
    }
    dispatch(setExecution({ id: proposal.id, status: statusValue, comment: execComment.trim(), by: fullName }));
    onClose();
  };

  return (
    <Modal open={open} onCancel={onClose} footer={null} width={540}
      title={<Space><Text strong>{proposal.riskTitle || proposal.metricName}</Text><Tag color={st.color}>{st.label}</Tag></Space>}
    >
      <Space wrap style={{ marginBottom: 8 }}>
        <Tag>{proposal.systemName}</Tag>
        <Tag>{proposal.characteristic}</Tag>
        <Tag color={tok.color} style={{ color: '#fff', border: 'none' }}>{proposal.calculatedScore}%</Tag>
      </Space>

      <Field label="Метрика">
        <Text>{proposal.metricName}</Text>
      </Field>
      <Field label="Что ожидается от ЛПР и почему">
        <Text>{proposal.expectation || '—'}</Text>
      </Field>
      <Field label="Обоснование (профессиональное суждение)">
        <Paragraph style={{ marginBottom: 0 }}>{proposal.rationale}</Paragraph>
      </Field>
      {isPending && canEditMeta ? (
        <Field label="Ответственный и срок (можно изменить перед решением)">
          <Space direction="vertical" size={6} style={{ width: '100%' }}>
            <Input value={editOwner} onChange={(e) => setEditOwner(e.target.value)} placeholder="ФИО ответственного" />
            <Input value={editOwnerRole} onChange={(e) => setEditOwnerRole(e.target.value)} placeholder="Должность ответственного" />
            <Input value={editDue} onChange={(e) => setEditDue(e.target.value)} placeholder="Срок выполнения (ДД.ММ.ГГГГ)" />
          </Space>
        </Field>
      ) : (proposal.owner || proposal.dueDate) ? (
        <Field label="Ответственный / срок">
          <Text>
            {proposal.owner || '—'}{proposal.ownerRole ? `, ${proposal.ownerRole}` : ''}
            {proposal.dueDate ? ` · до ${proposal.dueDate}` : ''}
          </Text>
        </Field>
      ) : null}

      <Divider style={{ margin: '12px 0' }} />

      {isPending ? (
        <>
          <Field label="Комментарий к решению (необязательно)">
            <Input.TextArea
              rows={3}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Обоснуйте решение: условия, приоритет, что требуется уточнить…"
            />
          </Field>
          <Space style={{ marginTop: 8 }}>
            <Button type="primary" icon={<CheckOutlined />}
              style={{ background: ragToken(85).color, borderColor: ragToken(85).color }}
              onClick={() => decide(approveProposal)}>
              Одобрить
            </Button>
            <Button danger icon={<CloseOutlined />} onClick={() => decide(rejectProposal)}>
              Отклонить
            </Button>
          </Space>
        </>
      ) : (
        <Field label={`Решение (${proposal.decidedBy || '—'})`}>
          <Paragraph style={{ marginBottom: 0 }}>
            {proposal.decisionComment || <Text type="secondary">Без комментария</Text>}
          </Paragraph>
        </Field>
      )}

      {/* Контроль выполнения одобренной меры — зона ответственности менеджера по качеству */}
      {isApproved && (
        <>
          <Divider style={{ margin: '12px 0' }} />
          {proposal.execution ? (
            <Field label={`Выполнение (${proposal.executedBy || '—'})`}>
              <Tag color={proposal.execution === 'DONE' ? 'green' : 'red'}>
                {proposal.execution === 'DONE' ? 'Выполнено' : 'Не выполнено'}
              </Tag>
              <Paragraph style={{ marginBottom: 0, marginTop: 4 }}>{proposal.executionComment}</Paragraph>
            </Field>
          ) : canReportExecution ? (
            <>
              <Field label="Контроль выполнения (комментарий обязателен)">
                <Input.TextArea
                  rows={3}
                  value={execComment}
                  onChange={(e) => setExecComment(e.target.value)}
                  placeholder="Как выполнено (что сделано, результат) или почему не выполнено (причина, новый срок)…"
                />
              </Field>
              <Space style={{ marginTop: 8 }}>
                <Button type="primary" icon={<CheckOutlined />}
                  style={{ background: ragToken(85).color, borderColor: ragToken(85).color }}
                  onClick={() => reportExecution('DONE')}>
                  Выполнено
                </Button>
                <Button danger icon={<CloseOutlined />} onClick={() => reportExecution('NOT_DONE')}>
                  Не выполнено
                </Button>
              </Space>
            </>
          ) : (
            <Text type="secondary" style={{ fontSize: 12 }}>Ожидает отчёта менеджера по качеству о выполнении.</Text>
          )}
        </>
      )}
    </Modal>
  );
};

export default MeasureDecisionModal;
