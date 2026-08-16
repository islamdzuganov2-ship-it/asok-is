/**
 * AssigneeTasksPage.tsx — «Мои задачи» для роли «Исполнитель» (ТЗ v17, req 6).
 *
 * Исполнитель видит назначенные на него поручения (меры, где owner = его ФИО) и может:
 *   • задавать уточнения по метрике/поручению (текстом);
 *   • предлагать новый срок по поручению с обоснованием.
 * Всё это «падает» менеджеру по качеству: уточнения и запрос переноса срока он видит в карточке
 * задачи «Плана задач» и решает по переносу (принять/отклонить). См. governanceSlice.
 *
 * Источник данных — governance-набор по режиму (mock/live). Дашборды у исполнителя те же, что у
 * топ-менеджмента (маршруты в App.tsx), но действия по мерам — только просмотр.
 */
import React, { useMemo, useState } from 'react';
import { Alert, Button, Col, DatePicker, Empty, Input, Modal, Row, Space, Statistic, Table, Tag, Timeline, Typography } from 'antd';
import { message } from '../theme/appMessage';
import type { ColumnsType } from 'antd/es/table';
import { CommentOutlined, FieldTimeOutlined, ScheduleOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useSelector } from 'react-redux';
import { RootState } from '../store';
import { useAppDispatch } from '../store/hooks';
import {
  selectProposalsForAssignee, addClarification, requestDueChange, type Proposal,
} from '../store/slices/governanceSlice';
import { BRAND, RAG, ragToken, solidTagStyle } from '../theme/ragPalette';
import { premiumCard, accentDot, pageContainer, pageTitle, GOLD, SPACE } from '../theme/premium';
import { sorterFor } from '../theme/table';

const { Title, Text, Paragraph } = Typography;

const parseRu = (d?: string): Date | null => {
  if (!d) return null;
  const m = /(\d{2})\.(\d{2})\.(\d{4})/.exec(d);
  return m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])) : null;
};
const TODAY = new Date(2026, 5, 26).getTime();

// Приоритет для сортировки по статусу — просроченное впереди, выполненное в хвосте (наглядно
// для исполнителя: что горит сильнее всего). statusTag использует тот же порядок условий.
const statusRank = (p: Proposal): number => {
  if (p.execution === 'DONE') return 4;
  if (p.execution === 'NOT_DONE') return 3;
  const d = parseRu(p.dueDate);
  if (d && d.getTime() < TODAY) return 0;
  if (p.status === 'APPROVED') return 2;
  return 1;
};

const statusTag = (p: Proposal) => {
  if (p.execution === 'DONE') return <Tag color="green">выполнено</Tag>;
  if (p.execution === 'NOT_DONE') return <Tag color="red">не выполнено</Tag>;
  const d = parseRu(p.dueDate);
  if (d && d.getTime() < TODAY) return <Tag color="red">просрочено</Tag>;
  if (p.status === 'APPROVED') return <Tag color="blue">в работе</Tag>;
  return <Tag color="gold">ожидает решения</Tag>;
};

const AssigneeTasksPage: React.FC = () => {
  const dispatch = useAppDispatch();
  const fullName = useSelector((s: RootState) => s.auth.fullName) || '';
  const tasks = useSelector(selectProposalsForAssignee(fullName));

  const [sel, setSel] = useState<Proposal | null>(null);
  const [clarify, setClarify] = useState('');
  const [newDue, setNewDue] = useState<dayjs.Dayjs | null>(null);
  const [justif, setJustif] = useState('');

  const stats = useMemo(() => {
    const done = tasks.filter((t) => t.execution === 'DONE').length;
    const overdue = tasks.filter((t) => t.execution === 'NOT_DONE' || (t.execution !== 'DONE' && (parseRu(t.dueDate)?.getTime() ?? Infinity) < TODAY)).length;
    return { total: tasks.length, done, overdue, eff: tasks.length ? Math.round((done / tasks.length) * 100) : 0 };
  }, [tasks]);

  const open = (p: Proposal) => { setSel(p); setClarify(''); setNewDue(p.dueDate ? dayjs(parseRu(p.dueDate)) : null); setJustif(''); };

  const submitClarify = () => {
    if (!sel || !clarify.trim()) { message.error('Введите текст уточнения'); return; }
    dispatch(addClarification({ id: sel.id, text: clarify.trim(), by: fullName }));
    message.success('Уточнение отправлено менеджеру по качеству');
    setClarify('');
    setSel((s) => (s ? { ...s, clarifications: [...(s.clarifications ?? []), { at: new Date().toISOString(), by: fullName, text: clarify.trim() }] } : s));
  };

  const submitDue = () => {
    if (!sel) return;
    if (!newDue) { message.error('Выберите предлагаемый срок'); return; }
    if (!justif.trim()) { message.error('Укажите обоснование переноса срока'); return; }
    const proposedDate = newDue.format('DD.MM.YYYY');
    dispatch(requestDueChange({ id: sel.id, proposedDate, justification: justif.trim(), by: fullName }));
    message.success('Запрос на перенос срока отправлен менеджеру по качеству');
    setSel(null);
  };

  const columns: ColumnsType<Proposal> = [
    { title: 'Поручение', dataIndex: 'riskTitle', sorter: sorterFor((r: Proposal) => r.riskTitle || r.metricName),
      render: (v: string, r) => (
      <div>
        <Text strong style={{ color: BRAND.ink }}>{v || r.metricName}</Text>
        <div style={{ fontSize: 12, color: BRAND.inkSoft }}>{r.systemName} · {r.characteristic}</div>
      </div>
    ) },
    { title: 'Балл', dataIndex: 'calculatedScore', width: 76, align: 'center',
      sorter: sorterFor((r: Proposal) => r.calculatedScore),
      render: (v: number) => <Tag style={solidTagStyle(ragToken(v).strong)}>{v}%</Tag> },
    { title: 'Срок', dataIndex: 'dueDate', width: 116,
      sorter: sorterFor((r: Proposal) => parseRu(r.dueDate)?.getTime() ?? null),
      render: (v: string, r) => (
      <Space direction="vertical" size={0}>
        <Text>{v || '—'}</Text>
        {r.dueChangeRequest?.status === 'PENDING' && <Tag color="gold" style={{ marginInlineEnd: 0 }}>перенос на рассмотрении</Tag>}
        {r.dueChangeRequest?.status === 'ACCEPTED' && <Tag color="green" style={{ marginInlineEnd: 0 }}>перенос принят</Tag>}
        {r.dueChangeRequest?.status === 'DECLINED' && <Tag color="red" style={{ marginInlineEnd: 0 }}>перенос отклонён</Tag>}
      </Space>
    ) },
    { title: 'Статус', key: 'status', width: 130, sorter: sorterFor((r: Proposal) => statusRank(r)),
      render: (_: unknown, r) => statusTag(r) },
    { title: 'Уточнения', key: 'clar', width: 96, align: 'center',
      render: (_: unknown, r) => (r.clarifications?.length ? <Tag icon={<CommentOutlined />}>{r.clarifications.length}</Tag> : <Text type="secondary">—</Text>) },
  ];

  return (
    <div style={pageContainer}>
      <Title level={4} style={pageTitle}><span style={accentDot(GOLD.base)} />Мои задачи</Title>
      <Text type="secondary">Поручения, назначенные на вас ({fullName}). Уточнения и предложения по срокам направляются менеджеру по качеству.</Text>

      <Row gutter={[16, 16]} style={{ margin: '16px 0' }}>
        <Col xs={12} md={6}><div {...premiumCard()}><Statistic title="Всего поручений" value={stats.total} /></div></Col>
        <Col xs={12} md={6}><div {...premiumCard()}><Statistic title="Выполнено" value={stats.done} valueStyle={{ color: RAG.good.strong }} /></div></Col>
        <Col xs={12} md={6}><div {...premiumCard()}><Statistic title="Просрочено / не выполнено" value={stats.overdue} valueStyle={{ color: stats.overdue ? RAG.bad.strong : undefined }} /></div></Col>
        <Col xs={12} md={6}><div {...premiumCard()}><Statistic title="Личная эффективность" value={stats.eff} suffix="%" valueStyle={{ color: ragToken(stats.eff).strong }} /></div></Col>
      </Row>

      {tasks.length === 0 ? (
        <Empty description="На вас пока не назначено поручений" style={{ padding: 48 }} />
      ) : (
        <Table<Proposal>
          rowKey="id"
          columns={columns}
          dataSource={tasks}
          size="small"
          pagination={{ pageSize: 10, hideOnSinglePage: true }}
          onRow={(r) => ({ onClick: () => open(r), style: { cursor: 'pointer' } })}
          scroll={{ x: 720 }}
        />
      )}

      <Modal open={!!sel} onCancel={() => setSel(null)} footer={null} width={640} title={sel ? (sel.riskTitle || sel.metricName) : ''}>
        {sel && (
          <Space direction="vertical" size={14} style={{ width: '100%' }}>
            <Space wrap>
              <Tag>{sel.systemName}</Tag>
              <Tag>{sel.characteristic}</Tag>
              {statusTag(sel)}
            </Space>
            <div><Text type="secondary">Метрика: </Text><Text>{sel.metricName}</Text></div>
            <div><Text type="secondary">Обоснование меры</Text><Paragraph style={{ marginBottom: 0 }}>{sel.rationale}</Paragraph></div>
            <div><Text type="secondary">Текущий срок: </Text><Text strong>{sel.dueDate || '—'}</Text></div>

            {/* Ранее внесённые уточнения */}
            {(sel.clarifications?.length ?? 0) > 0 && (
              <div>
                <Text strong><CommentOutlined /> Мои уточнения</Text>
                <Timeline style={{ marginTop: 8 }} items={(sel.clarifications ?? []).map((c) => ({
                  children: <><Text>{c.text}</Text><div style={{ fontSize: 11, color: BRAND.inkSoft }}>{dayjs(c.at).format('DD.MM.YYYY HH:mm')} · {c.by}</div></>,
                }))} />
              </div>
            )}

            {/* Уточнение по метрике/поручению */}
            <div>
              <Text type="secondary"><CommentOutlined /> Уточнение по метрике / поручению (уйдёт менеджеру по качеству)</Text>
              <Input.TextArea rows={2} value={clarify} onChange={(e) => setClarify(e.target.value)} placeholder="Например: метрика посчитана без учёта планового окна; фактический показатель выше…" />
              <Button style={{ marginTop: 8 }} icon={<CommentOutlined />} onClick={submitClarify}>Отправить уточнение</Button>
            </div>

            {/* Предложение нового срока */}
            <div>
              <Text type="secondary"><FieldTimeOutlined /> Предложить новый срок с обоснованием</Text>
              {sel.dueChangeRequest && sel.dueChangeRequest.status !== 'PENDING' && (
                <Alert
                  style={{ margin: '8px 0' }}
                  type={sel.dueChangeRequest.status === 'ACCEPTED' ? 'success' : 'warning'}
                  showIcon
                  message={`Предыдущий запрос (${sel.dueChangeRequest.proposedDate}) — ${sel.dueChangeRequest.status === 'ACCEPTED' ? 'принят' : 'отклонён'} менеджером по качеству`}
                  description={sel.dueChangeRequest.decisionComment}
                />
              )}
              {sel.dueChangeRequest?.status === 'PENDING' ? (
                <Alert style={{ marginTop: 8 }} type="info" showIcon
                  message={`Запрос на перенос срока на ${sel.dueChangeRequest.proposedDate} направлен и ожидает решения менеджера по качеству`}
                  description={sel.dueChangeRequest.justification} />
              ) : (
                <Space direction="vertical" style={{ width: '100%', marginTop: 8 }} size={8}>
                  <DatePicker value={newDue} onChange={setNewDue} format="DD.MM.YYYY" style={{ width: 200 }} placeholder="Новый срок" />
                  <Input.TextArea rows={2} value={justif} onChange={(e) => setJustif(e.target.value)} placeholder="Обоснование переноса срока (причина, риски, что требуется)…" />
                  <Button type="primary" icon={<ScheduleOutlined />} onClick={submitDue}>Предложить срок менеджеру по качеству</Button>
                </Space>
              )}
            </div>
          </Space>
        )}
      </Modal>
    </div>
  );
};

export default AssigneeTasksPage;
