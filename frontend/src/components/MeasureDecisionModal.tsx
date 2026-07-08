/**
 * MeasureDecisionModal.tsx — карточка меры качества с принятием решения.
 *
 * Открывается по клику на меру (в управленческом дашборде / реестре). Показывает
 * полный контекст меры и, если она ожидает решения, даёт топ-менеджменту
 * одобрить/отклонить с обязательной возможностью оставить комментарий-обоснование.
 * Для уже решённых мер показывает решение и комментарий ЛПР (read-only).
 *
 * Топ-менеджмент может ВНОСИТЬ ПРАВКИ в меру (кнопка «Внести правки»): название, обоснование,
 * ожидание от ЛПР, ответственный, срок. Каждая правка пишется в историю изменений (аудит),
 * которая открывается кнопкой-иконкой (только иконка истории, без текста).
 */
import React, { useEffect, useState } from 'react';
import { Modal, Typography, Tag, Input, Button, Space, Divider, List, Tooltip, Empty, message } from 'antd';
import { CheckOutlined, CloseOutlined, EditOutlined, HistoryOutlined } from '@ant-design/icons';
import { useSelector } from 'react-redux';
import { useAppDispatch } from '../store/hooks';
import { RootState } from '../store';
import {
  approveProposal, rejectProposal, setExecution, updateProposalMeta, editProposal,
  type EditableProposalFields, type Proposal, type ProposalStatus,
} from '../store/slices/governanceSlice';
import { ragToken } from '../theme/ragPalette';

const { Text, Paragraph } = Typography;

const STATUS_TAG: Record<ProposalStatus, { color: string; label: string }> = {
  PENDING_APPROVAL: { color: 'gold', label: 'Ожидает решения' },
  APPROVED: { color: 'green', label: 'Одобрена' },
  REJECTED: { color: 'red', label: 'Отклонена' },
};

// Человекочитаемые названия полей для истории правок (аудита).
const FIELD_LABELS: Record<string, string> = {
  riskTitle: 'Название меры/риска',
  rationale: 'Обоснование',
  expectation: 'Ожидание от ЛПР',
  owner: 'Ответственный',
  ownerRole: 'Должность ответственного',
  dueDate: 'Срок',
  topComment: 'Комментарий топ-менеджера',
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

const fmtTime = (iso: string) => new Date(iso).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });

export const MeasureDecisionModal: React.FC<Props> = ({ open, proposal, onClose }) => {
  const dispatch = useAppDispatch();
  const fullName = useSelector((s: RootState) => s.auth.fullName) || 'Топ-менеджмент';
  const role = useSelector((s: RootState) => s.auth.role) || '';
  // Свежая версия меры из стора (после правок/решений пропс может устареть).
  const current = useSelector((s: RootState) =>
    proposal ? s.governance.proposals.find((x) => x.id === proposal.id) ?? proposal : null);
  const [comment, setComment] = useState('');
  const [execComment, setExecComment] = useState('');
  // Редактируемые топ-менеджментом поля (ответственный/срок) до принятия решения.
  const [editOwner, setEditOwner] = useState('');
  const [editOwnerRole, setEditOwnerRole] = useState('');
  const [editDue, setEditDue] = useState('');
  // Режим «Внести правки» (топ-менеджер) + буфер правок; история — отдельная модалка.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Partial<EditableProposalFields>>({});
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    setComment(''); setExecComment('');
    setEditOwner(proposal?.owner || '');
    setEditOwnerRole(proposal?.ownerRole || '');
    setEditDue(proposal?.dueDate || '');
    setEditing(false); setDraft({}); setHistoryOpen(false);
  }, [proposal?.id]);

  if (!current) return null;
  const p = current;
  const isPending = p.status === 'PENDING_APPROVAL';
  const isApproved = p.status === 'APPROVED';
  // Отчёт о выполнении (закрытие меры) — зона ответственности ТОЛЬКО менеджера по качеству (SoD, ТЗ v12).
  const canReportExecution = role === 'QUALITY_MANAGER';
  // Согласование работ по мере (одобрить/отклонить) — ТОЛЬКО топ-менеджмент (ADMIN-уровень) (SoD, ТЗ v12).
  const canDecide = ['ADMIN', 'CTO', 'CEO', 'CIO', 'EXECUTIVE'].includes(role);
  // Менять ответственного/срок перед решением может топ-менеджмент (ЛПР).
  const canEditMeta = canDecide;
  // Вносить правки в меру (с аудитом) — топ-менеджмент, на любом статусе.
  const canEdit = canDecide;
  const st = STATUS_TAG[p.status];
  const tok = ragToken(p.calculatedScore);
  const history = p.history ?? [];

  const decide = (action: typeof approveProposal | typeof rejectProposal) => {
    if (isPending && canEditMeta) {
      dispatch(updateProposalMeta({
        id: p.id,
        owner: editOwner.trim(),
        ownerRole: editOwnerRole.trim(),
        dueDate: editDue.trim() || undefined,
      }));
    }
    dispatch(action({ id: p.id, by: fullName, comment: comment.trim() || undefined }));
    onClose();
  };

  const reportExecution = (statusValue: 'DONE' | 'NOT_DONE') => {
    if (!execComment.trim()) {
      message.error('Комментарий обязателен: укажите, как выполнено или почему не выполнено');
      return;
    }
    dispatch(setExecution({ id: p.id, status: statusValue, comment: execComment.trim(), by: fullName }));
    onClose();
  };

  const startEdit = () => {
    setDraft({
      riskTitle: p.riskTitle || '',
      rationale: p.rationale,
      expectation: p.expectation,
      owner: p.owner || '',
      ownerRole: p.ownerRole || '',
      dueDate: p.dueDate || '',
    });
    setEditing(true);
  };

  const saveEdit = () => {
    dispatch(editProposal({ id: p.id, by: `${fullName}${role ? ` (${role})` : ''}`, patch: draft }));
    setEditing(false);
    message.success('Правки сохранены и записаны в историю изменений');
  };

  const setD = (field: keyof EditableProposalFields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setDraft((d) => ({ ...d, [field]: e.target.value }));

  return (
    <Modal open={open} onCancel={onClose} footer={null} width={540}
      title={
        <Space style={{ width: '100%', justifyContent: 'space-between', paddingRight: 24 }}>
          <Space>
            <Text strong>{p.riskTitle || p.metricName}</Text>
            <Tag color={st.color}>{st.label}</Tag>
          </Space>
          <Space size={4}>
            {canEdit && !editing && (
              <Button size="small" icon={<EditOutlined />} onClick={startEdit}>Внести правки</Button>
            )}
            <Tooltip title="История изменений (аудит)">
              <Button
                size="small"
                type="text"
                aria-label="История изменений"
                icon={<HistoryOutlined />}
                onClick={() => setHistoryOpen(true)}
              />
            </Tooltip>
          </Space>
        </Space>
      }
    >
      <Space wrap style={{ marginBottom: 8 }}>
        <Tag>{p.systemName}</Tag>
        <Tag>{p.characteristic}</Tag>
        <Tag color={tok.color} style={{ color: '#fff', border: 'none' }}>{p.calculatedScore}%</Tag>
      </Space>

      {editing ? (
        <>
          <Field label="Название меры/риска">
            <Input value={draft.riskTitle} onChange={setD('riskTitle')} />
          </Field>
          <Field label="Обоснование (профессиональное суждение)">
            <Input.TextArea rows={3} value={draft.rationale} onChange={setD('rationale')} />
          </Field>
          <Field label="Что ожидается от ЛПР и почему">
            <Input.TextArea rows={2} value={draft.expectation} onChange={setD('expectation')} />
          </Field>
          <Field label="Ответственный / должность / срок">
            <Space direction="vertical" size={6} style={{ width: '100%' }}>
              <Input value={draft.owner} onChange={setD('owner')} placeholder="ФИО ответственного" />
              <Input value={draft.ownerRole} onChange={setD('ownerRole')} placeholder="Должность ответственного" />
              <Input value={draft.dueDate} onChange={setD('dueDate')} placeholder="Срок выполнения (ДД.ММ.ГГГГ)" />
            </Space>
          </Field>
          <Space style={{ marginTop: 4, marginBottom: 8 }}>
            <Button type="primary" icon={<CheckOutlined />} onClick={saveEdit}>Сохранить правки</Button>
            <Button onClick={() => setEditing(false)}>Отмена</Button>
          </Space>
          <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
            Каждое изменение будет записано в историю изменений (аудит) с указанием автора и времени.
          </Paragraph>
        </>
      ) : (
        <>
          <Field label="Метрика">
            <Text>{p.metricName}</Text>
          </Field>
          <Field label="Что ожидается от ЛПР и почему">
            <Text>{p.expectation || '—'}</Text>
          </Field>
          <Field label="Обоснование (профессиональное суждение)">
            <Paragraph style={{ marginBottom: 0 }}>{p.rationale}</Paragraph>
          </Field>
          {isPending && canEditMeta ? (
            <Field label="Ответственный и срок (можно изменить перед решением)">
              <Space direction="vertical" size={6} style={{ width: '100%' }}>
                <Input value={editOwner} onChange={(e) => setEditOwner(e.target.value)} placeholder="ФИО ответственного" />
                <Input value={editOwnerRole} onChange={(e) => setEditOwnerRole(e.target.value)} placeholder="Должность ответственного" />
                <Input value={editDue} onChange={(e) => setEditDue(e.target.value)} placeholder="Срок выполнения (ДД.ММ.ГГГГ)" />
              </Space>
            </Field>
          ) : (p.owner || p.dueDate) ? (
            <Field label="Ответственный / срок">
              <Text>
                {p.owner || '—'}{p.ownerRole ? `, ${p.ownerRole}` : ''}
                {p.dueDate ? ` · до ${p.dueDate}` : ''}
              </Text>
            </Field>
          ) : null}

          <Divider style={{ margin: '12px 0' }} />

          {isPending ? (
            canDecide ? (
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
              <Text type="secondary" style={{ fontSize: 12 }}>Ожидается решение</Text>
            )
          ) : (
            <Field label={`Решение (${p.decidedBy || '—'})`}>
              <Paragraph style={{ marginBottom: 0 }}>
                {p.decisionComment || <Text type="secondary">Без комментария</Text>}
              </Paragraph>
            </Field>
          )}

          {/* Контроль выполнения одобренной меры — зона ответственности менеджера по качеству */}
          {isApproved && (
            <>
              <Divider style={{ margin: '12px 0' }} />
              {p.execution ? (
                <Field label={`Выполнение (${p.executedBy || '—'})`}>
                  <Tag color={p.execution === 'DONE' ? 'green' : 'red'}>
                    {p.execution === 'DONE' ? 'Выполнено' : 'Не выполнено'}
                  </Tag>
                  <Paragraph style={{ marginBottom: 0, marginTop: 4 }}>{p.executionComment}</Paragraph>
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
        </>
      )}

      {/* История изменений (аудит правок меры) — открывается кнопкой-иконкой */}
      <Modal
        open={historyOpen}
        onCancel={() => setHistoryOpen(false)}
        footer={null}
        width={560}
        title={<Space><HistoryOutlined /> История изменений — «{p.riskTitle || p.metricName}»</Space>}
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
                    <Text strong style={{ fontSize: 13 }}>{FIELD_LABELS[h.field] ?? h.field}</Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>{h.by}</Text>
                  </Space>
                  <Text style={{ fontSize: 13 }}>
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
    </Modal>
  );
};

export default MeasureDecisionModal;
