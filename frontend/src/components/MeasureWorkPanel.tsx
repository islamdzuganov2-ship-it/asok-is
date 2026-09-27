/**
 * MeasureWorkPanel.tsx — ответственный и «В работу» на карточке меры (ТЗ v19 п.16, УК-38).
 *
 *  • УК-40: ответственный = исполнитель — если это один человек, карточка показывает ОДНО поле
 *    «Ответственный (ОМ)», а не два одинаковых ФИО;
 *  • УК-38: кнопка «В работу» — одно действие без повторного ввода: исполнитель, срок,
 *    трудоёмкость, текст для исполнителя (сформирован и доступен для правки перед отправкой,
 *    В-51), запись на внутреннем Ганте, уведомление;
 *  • УК-33: предупреждение, если исполнитель после назначения окажется перегружен;
 *  • УК-17: срок меры — файлом .ics и приглашением в календарь исполнителя.
 */
import React, { useEffect, useState } from 'react';
import { Alert, Button, Checkbox, Input, InputNumber, Modal, Space, Tag, Tooltip, Typography } from 'antd';
import { CalendarOutlined, PlayCircleOutlined } from '@ant-design/icons';
import { useSelector } from 'react-redux';
import type { RootState } from '../store';
import { useAppDispatch } from '../store/hooks';
import { takeToWork, type Proposal } from '../store/slices/governanceSlice';
import { useLazyCheckExecutorLoadQuery, useLazyPreviewExecutorBriefQuery } from '../store/api/controlApi';
import { message } from '../theme/appMessage';
import { SPACE, TYPE } from '../theme/premium';

const { Text } = Typography;
const API = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api/v1';

/** ДД.ММ.ГГГГ → ГГГГ-ММ-ДД для <input type="date">. */
export const toIsoDate = (ru?: string): string => {
  const m = /(\d{2})\.(\d{2})\.(\d{4})/.exec(ru || '');
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
};

/** УК-40: ответственный и исполнитель — один человек? Тогда поле одно. */
export const isSingleOwner = (p: Pick<Proposal, 'ownerUserId' | 'executedByUserId' | 'owner' | 'executedBy'>): boolean =>
  (!p.executedByUserId || p.executedByUserId === p.ownerUserId)
  && (!p.executedBy || !p.owner || p.executedBy === p.owner);

async function downloadIcs(id: string): Promise<void> {
  const token = localStorage.getItem('token');
  const r = await fetch(`${API}/governance/proposals/${id}/calendar.ics`,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!r.ok) throw new Error(r.status === 409 ? 'У меры нет срока' : `HTTP ${r.status}`);
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement('a');
  a.href = url; a.download = `measure-${id}.ics`; a.click();
  URL.revokeObjectURL(url);
}

const TakeToWorkModal: React.FC<{ p: Proposal; open: boolean; onClose: () => void }> = ({ p, open, onClose }) => {
  const dispatch = useAppDispatch();
  const live = useSelector((s: RootState) => s.ui.dataMode === 'live');
  const [owner, setOwner] = useState(p.owner || '');
  const [due, setDue] = useState(toIsoDate(p.dueDate));
  const [hours, setHours] = useState<number | null>(p.effortHours ?? null);
  const [brief, setBrief] = useState(p.executorBrief || '');
  const [calendar, setCalendar] = useState(true);
  const [saving, setSaving] = useState(false);
  const [preview, { isFetching: briefLoading }] = useLazyPreviewExecutorBriefQuery();
  const [check, { data: load }] = useLazyCheckExecutorLoadQuery();

  useEffect(() => {
    if (!open || brief) return;
    if (live) preview(p.id).unwrap().then((r) => setBrief(r.text)).catch(() => setBrief(p.expectation || ''));
    else setBrief(`Что сделать: ${p.expectation || p.rationale}.`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, p.id]);

  useEffect(() => {
    if (!open || !live || !owner.trim()) return;
    const t = setTimeout(() => check({ owner: owner.trim(), hours, proposalId: p.id }), 400);
    return () => clearTimeout(t);
  }, [open, live, owner, hours, p.id, check]);

  const submit = async () => {
    if (!owner.trim()) { message.warning('Укажите исполнителя'); return; }
    setSaving(true);
    try {
      await dispatch(takeToWork({
        id: p.id, owner: owner.trim(), dueDate: due || undefined, effortHours: hours,
        executorBrief: brief.trim() || undefined, sendCalendar: calendar,
      })).unwrap();
      message.success('Мера в работе: задача на Ганте, уведомление исполнителю — в журнале уведомлений');
      onClose();
    } catch (e: any) {
      message.error(e?.message || 'Не удалось взять меру в работу');
    } finally { setSaving(false); }
  };

  return (
    <Modal open={open} onCancel={onClose} title="В работу" okText="Взять в работу" onOk={submit}
      confirmLoading={saving} width={560} destroyOnHidden>
      <Space direction="vertical" size={SPACE.cozy} style={{ width: '100%' }}>
        <div>
          <Text type="secondary" style={{ fontSize: TYPE.caption.fontSize }}>Исполнитель (ответственный, ОМ)</Text>
          <Input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="ФИО исполнителя" />
        </div>
        <Space wrap>
          <div>
            <Text type="secondary" style={{ fontSize: TYPE.caption.fontSize, display: 'block' }}>Срок</Text>
            <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </div>
          <div>
            <Text type="secondary" style={{ fontSize: TYPE.caption.fontSize, display: 'block' }}>Трудоёмкость, ч</Text>
            <InputNumber min={0.5} step={1} value={hours} onChange={(v) => setHours(v)} placeholder="оценка исполнителя" />
          </div>
        </Space>
        {load?.overloaded && (
          <Alert type="warning" showIcon message="Исполнитель будет перегружен"
            description={`${load.message}. Назначение не запрещено — проверьте балансировку на «Плане задач».`} />
        )}
        {load && !load.overloaded && (
          <Text type="secondary" style={{ fontSize: TYPE.caption.fontSize }}>
            Загрузка после назначения: {load.hoursAfter} ч при норме {load.normHours} ч.
          </Text>
        )}
        <div>
          <Text type="secondary" style={{ fontSize: TYPE.caption.fontSize }}>
            Текст для исполнителя — проверьте перед отправкой (управленческая формулировка сохранится)
          </Text>
          <Input.TextArea rows={6} value={brief} onChange={(e) => setBrief(e.target.value)}
            placeholder={briefLoading ? 'Формируется…' : 'Шаги, критерий готовности, нужные доступы'} />
        </div>
        <Checkbox checked={calendar} onChange={(e) => setCalendar(e.target.checked)}>
          Отправить срок в календарь исполнителя (iCalendar)
        </Checkbox>
      </Space>
    </Modal>
  );
};

export const MeasureWorkPanel: React.FC<{ p: Proposal }> = ({ p }) => {
  const canManage = useSelector((s: RootState) => s.auth.permissions.includes('governance.propose'));
  const live = useSelector((s: RootState) => s.ui.dataMode === 'live');
  const [open, setOpen] = useState(false);
  const approved = p.status === 'APPROVED';
  const single = isSingleOwner(p);

  return (
    <div style={{ marginBottom: SPACE.cozy }}>
      <Text type="secondary" style={{ fontSize: TYPE.caption.fontSize }}>
        {single ? 'Ответственный (ОМ) / срок' : 'Ответственный / срок'}
      </Text>
      <div>
        <Text>{p.owner || '—'}{p.ownerRole ? `, ${p.ownerRole}` : ''}{p.dueDate ? ` · до ${p.dueDate}` : ''}</Text>
        {!single && p.executedBy && <Text type="secondary"> · исполнил: {p.executedBy}</Text>}
      </div>
      <Space wrap size={6} style={{ marginTop: 4 }}>
        {p.takenToWorkAt && (
          <Tooltip title={p.taskRef ? `Задача на Ганте: ${p.taskRef}` : 'Задача на Ганте'}>
            <Tag color="blue">в работе с {new Date(p.takenToWorkAt).toLocaleDateString('ru-RU')}</Tag>
          </Tooltip>
        )}
        {p.effortHours != null && <Tag>{p.effortHours} ч</Tag>}
        {approved && canManage && p.execution !== 'DONE' && (
          <Button size="small" type="primary" icon={<PlayCircleOutlined />} onClick={() => setOpen(true)}>
            {p.takenToWorkAt ? 'Переназначить' : 'В работу'}
          </Button>
        )}
        {live && (p.dueOn || p.dueDate) && (
          <Button size="small" icon={<CalendarOutlined />}
            onClick={() => downloadIcs(p.id).catch((e) => message.error(e.message))}>
            В календарь (.ics)
          </Button>
        )}
      </Space>
      {approved && <TakeToWorkModal p={p} open={open} onClose={() => setOpen(false)} />}
    </div>
  );
};

export default MeasureWorkPanel;
