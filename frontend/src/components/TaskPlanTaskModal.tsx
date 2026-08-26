/**
 * TaskPlanTaskModal.tsx — карточка задачи «Плана задач»: управление, эскалация, решение.
 *
 * Вынесена из TaskPlanScope. Заодно ушло дублирование состояния: поля формы (ссылка на СУЗ,
 * ответственный, срок, комментарий, причина эскалации) — состояние ИМЕННО этой модалки, и
 * держать их в скоупе дашборда было незачем. Скоуп теперь передаёт только саму меру.
 *
 * Разграничение ролей (SoD) перенесено дословно:
 *   • эскалацию инициирует ТОЛЬКО менеджер по качеству — с причиной невыполнения/просрочки;
 *   • решение по эскалации принимает ТОЛЬКО топ-менеджмент;
 *   • после решения задачу отрабатывает менеджер по качеству.
 */
import React, { useEffect, useState } from 'react';
import { Alert, Button, Input, Modal, Space, Tag, Typography } from 'antd';
import { message } from '../theme/appMessage';
import {
  LinkOutlined, WarningOutlined, CheckOutlined, CloseOutlined, RiseOutlined, StopOutlined,
  FileTextOutlined,
} from '@ant-design/icons';
import { useSelector } from 'react-redux';
import type { RootState } from '../store';
import { useAppDispatch } from '../store/hooks';
import {
  updateTask, setExecution, escalateTask, decideEscalation, resolveEscalation,
  rewriteForExecutor, type Proposal,
} from '../store/slices/governanceSlice';
import { BRAND } from '../theme/ragPalette';
import { GOLD, TYPE } from '../theme/premium';
import { MeasureCardExtras } from './MeasureCardExtras';

const { Text, Paragraph } = Typography;

interface Props {
  /** Открытая мера или null. Смена меры переинициализирует поля формы. */
  proposal: Proposal | null;
  onClose: () => void;
  /** Мера изменилась на месте (например, LLM переписала её для исполнителя). */
  onReplace: (p: Proposal) => void;
}

export const TaskPlanTaskModal: React.FC<Props> = ({ proposal: sel, onClose, onReplace }) => {
  const dispatch = useAppDispatch();
  const role = useSelector((s: RootState) => s.auth.role) || '';
  const fullName = useSelector((s: RootState) => s.auth.fullName) || 'Пользователь';
  const canManage = role === 'QUALITY_MANAGER';
  const isExec = ['ADMIN', 'CTO', 'CEO', 'CIO', 'EXECUTIVE'].includes(role);
  // §17.6 (УК-56): ревью LLM-рекомендаций — тот же состав ролей, что MeasureDecisionModal.
  const canReviewLlm = role === 'QUALITY_MANAGER' || role === 'RISK_MANAGER';

  const [comment, setComment] = useState('');
  const [escReason, setEscReason] = useState('');
  const [suz, setSuz] = useState('');
  const [owner, setOwner] = useState('');
  const [due, setDue] = useState('');
  const [rewriting, setRewriting] = useState(false);

  useEffect(() => {
    if (!sel) return;
    setComment(sel.topComment || '');
    setEscReason('');
    setSuz(sel.suzLink || '');
    setOwner(sel.owner || '');
    setDue(sel.dueDate || '');
  }, [sel?.id]);

  if (!sel) return <Modal open={false} footer={null} onCancel={onClose} />;

  const saveManage = () => {
    dispatch(updateTask({ id: sel.id, suzLink: suz.trim(), owner: owner.trim(), dueDate: due.trim() || undefined }));
    message.success('Задача обновлена');
    onClose();
  };
  const saveComment = () => {
    dispatch(updateTask({ id: sel.id, topComment: comment.trim() }));
    message.success('Комментарий сохранён');
    onClose();
  };
  const doEscalate = () => {
    if (!escReason.trim()) { message.error('Укажите причину невыполнения/просрочки задачи'); return; }
    dispatch(escalateTask({ id: sel.id, reason: escReason.trim(), by: fullName }));
    message.warning('Эскалировано топ-менеджменту на решение');
    onClose();
  };
  const decide = (decision: 'IGNORE' | 'REQUEST_MEASURES') => {
    dispatch(decideEscalation({ id: sel.id, decision, comment: comment.trim(), by: fullName }));
    message.success(decision === 'IGNORE' ? 'Дано указание игнорировать' : 'Запрошены дополнительные меры');
    onClose();
  };
  const resolve = () => {
    dispatch(resolveEscalation({ id: sel.id }));
    message.success('Эскалация отработана');
    onClose();
  };
  const doRewrite = async () => {
    if (sel.status !== 'APPROVED') { message.info('Переписать для исполнителя можно только по одобренной мере'); return; }
    setRewriting(true);
    try {
      const updated = await dispatch(rewriteForExecutor({ id: sel.id })).unwrap();
      message.success('Мера переписана на язык исполнителя');
      if (updated) onReplace(updated);
    } catch {
      message.error('Не удалось переписать меру');
    } finally {
      setRewriting(false);
    }
  };
  const markExec = (status: 'DONE' | 'NOT_DONE') => {
    if (sel.status !== 'APPROVED') { message.info('Отметка о выполнении доступна для одобренных мер'); return; }
    dispatch(setExecution({ id: sel.id, status, comment: comment.trim() || (status === 'DONE' ? 'Выполнено' : 'Не выполнено'), by: fullName }));
    onClose();
  };

  return (
    <Modal open onCancel={onClose} footer={null} width={640} title={sel.riskTitle || sel.metricName}>
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Space wrap>
          <Tag>{sel.characteristic}</Tag>
          <Tag color={sel.status === 'APPROVED' ? 'green' : sel.status === 'REJECTED' ? 'red' : 'gold'}>{sel.status}</Tag>
          {sel.execution === 'DONE' && <Tag color="green">выполнено</Tag>}
          {sel.escalated && <Tag color="purple">эскалирована</Tag>}
        </Space>

        {/* Та же карточка, что на управленческом дашборде: Ц_ОМ, LLM-ревью, системность,
            направление, альтернативы — без урезания на Ганте (ТЗ v19 §17, п.9.2). */}
        <MeasureCardExtras proposal={sel} canManageCard={canManage} canReviewLlm={canReviewLlm} />

        {sel.executorBrief && (
          <div style={{ background: BRAND.surfaceSoft, borderRadius: 8, padding: 12, borderInlineStart: `3px solid ${GOLD.base}` }}>
            <Text type="secondary" style={TYPE.caption}><FileTextOutlined /> Для исполнителя</Text>
            <Paragraph style={{ marginBottom: 0, marginTop: 4 }}>{sel.executorBrief}</Paragraph>
          </div>
        )}
        <div><Text type="secondary">Фактура / обоснование</Text><Paragraph style={{ marginBottom: 0 }}>{sel.rationale}</Paragraph></div>

        {sel.escalated && (
          <Alert
            type={sel.escalationDecision ? 'info' : 'warning'}
            showIcon
            message={sel.escalationDecision
              ? `Решение топ-менеджмента: ${sel.escalationDecision === 'IGNORE' ? 'указание игнорировать' : 'запросить доп. меры'}`
              : 'Эскалация: причина невыполнения задачи'}
            description={
              <>
                <div>Причина (менеджер по качеству): {sel.escalationReason || '—'}</div>
                {sel.escalationDecision && <div style={{ marginTop: 4 }}>Указание топ-менеджмента: {sel.escalationDecisionComment || '—'} ({sel.escalationDecidedBy})</div>}
              </>
            }
          />
        )}

        {canManage && (
          <>
            <Alert type="info" showIcon message="Управление задачей (менеджер по качеству)" />
            <div><Text type="secondary"><LinkOutlined /> Задача в СУЗ (ссылка)</Text>
              <Input value={suz} onChange={(e) => setSuz(e.target.value)} placeholder="https://suz.bank/task/123" /></div>
            <Space wrap>
              <div><Text type="secondary">Ответственный (владелец/менеджер процесса)</Text>
                <Input value={owner} onChange={(e) => setOwner(e.target.value)} style={{ width: 280 }} /></div>
              <div><Text type="secondary">Срок</Text>
                <Input value={due} onChange={(e) => setDue(e.target.value)} placeholder="ДД.ММ.ГГГГ" style={{ width: 150 }} /></div>
            </Space>
            <Space wrap>
              <Button type="primary" onClick={saveManage}>Сохранить</Button>
              <Button icon={<CheckOutlined />} onClick={() => markExec('DONE')}>Выполнено</Button>
              <Button danger icon={<CloseOutlined />} onClick={() => markExec('NOT_DONE')}>Не выполнено</Button>
              {sel.status === 'APPROVED' && (
                <Button icon={<FileTextOutlined />} loading={rewriting} onClick={doRewrite}>
                  {sel.executorBrief ? 'Переписать заново' : 'Переписать для исполнителя'}
                </Button>
              )}
            </Space>

            {sel.escalated && sel.escalationDecision ? (
              <Button type="primary" onClick={resolve}>Отработать (закрыть эскалацию)</Button>
            ) : sel.escalated ? (
              <Text type="secondary">Эскалация направлена — ожидает решения топ-менеджмента.</Text>
            ) : (
              <div>
                <Text type="secondary"><RiseOutlined /> Эскалация: причина невыполнения/просрочки (обязательно)</Text>
                <Input.TextArea rows={2} value={escReason} onChange={(e) => setEscReason(e.target.value)}
                  placeholder="Почему задача не выполнена или просрочена…" />
                <Button danger icon={<WarningOutlined />} style={{ marginTop: 8 }} onClick={doEscalate}>
                  Эскалировать → топ-менеджмент
                </Button>
              </div>
            )}
          </>
        )}

        {isExec && (
          sel.escalated && !sel.escalationDecision ? (
            <>
              <Alert type="warning" showIcon message="Решение по эскалации (топ-менеджмент)"
                description="Задача не выполнена. Дайте прямое указание игнорировать либо запросите дополнительные меры по устранению." />
              <Input.TextArea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Указание / комментарий…" />
              <Space>
                <Button icon={<StopOutlined />} onClick={() => decide('IGNORE')}>Указание игнорировать</Button>
                <Button type="primary" danger icon={<RiseOutlined />} onClick={() => decide('REQUEST_MEASURES')}>Запросить доп. меры</Button>
              </Space>
            </>
          ) : (
            <>
              <Text type="secondary">Комментарий топ-менеджмента</Text>
              <Input.TextArea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Комментарий к задаче…" />
              <Button type="primary" onClick={saveComment}>Сохранить комментарий</Button>
            </>
          )
        )}
        {!isExec && !canManage && sel.topComment && (
          <div><Text type="secondary">Комментарий топ-менеджера:</Text><Paragraph style={{ marginBottom: 0 }}>{sel.topComment}</Paragraph></div>
        )}
      </Space>
    </Modal>
  );
};

export default TaskPlanTaskModal;
