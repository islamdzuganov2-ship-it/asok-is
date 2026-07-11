/**
 * TaskPlanDashboard.tsx — «План задач по повышению качества» (формирование тех. долга).
 * Два представления (ТЗ v15, T-23/T-24), обе карточки сворачиваемые «в самом верху»:
 *   1) читаемая временная диаграмма (Ганта): сроки/статусы задач по времени;
 *   2) пузырьковая карта задач (TaskBubbleTimeline): ось Y — ОТВЕТСТВЕННЫЕ, X — срок исполнения;
 *      цвет-свечение = зона (красный — просрочено, жёлтый — зона риска, зелёный — в плане);
 *      совпавшие по дате задачи одного ответственного собираются в «пирог» и разъезжаются при
 *      наведении; под диаграммой — сворачиваемый список задач (тема · ответственный · срок).
 * В самой диаграмме системы не подписываются (ось Y — ответственные), но их можно отфильтровать
 * селектором в шапке. Клик по пузырьку/строке списка открывает карточку задачи.
 *
 * Эскалация (SoD):
 *   • инициирует ТОЛЬКО менеджер по качеству — с причиной невыполнения/просрочки;
 *   • решение принимает ТОЛЬКО топ-менеджмент — «указание игнорировать» или «запросить доп. меры»;
 *   • после решения задачу отрабатывает менеджер по качеству.
 */
import React, { useMemo, useState } from 'react';
import { Typography, Tag, Space, Input, Button, Modal, message, Alert, Tooltip, Empty, Segmented, Select, Table } from 'antd';
import {
  LinkOutlined, WarningOutlined, CheckOutlined, CloseOutlined, RiseOutlined, StopOutlined,
  ScheduleOutlined, DatabaseOutlined, DownOutlined, UnorderedListOutlined,
} from '@ant-design/icons';
import { useSelector, shallowEqual } from 'react-redux';
import { useAppDispatch } from '../../store/hooks';
import { RootState } from '../../store';
import {
  selectVisibleProposals, updateTask, setExecution, escalateTask, decideEscalation, resolveEscalation, type Proposal,
} from '../../store/slices/governanceSlice';
import { BRAND } from '../../theme/ragPalette';
import { pageContainer, pageTitle, GOLD, accentDot } from '../../theme/premium';
import CollapsibleCard from '../../components/CollapsibleCard';
import TaskBubbleTimeline from '../../components/TaskBubbleTimeline';

const { Title, Text, Paragraph } = Typography;

const DAY = 86400000;
const LABEL_W = 300;
const RISK_DAYS = 14; // «зона риска» — до срока осталось ≤ 14 дней
const ALL_SYS = '__ALL__';
const parseRu = (d?: string): Date | null => {
  if (!d) return null;
  const m = /(\d{2})\.(\d{2})\.(\d{4})/.exec(d);
  return m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])) : null;
};
const fmt = (d: Date) => d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });

type Kind = 'done' | 'overdue' | 'escalated' | 'progress' | 'pending';
const KIND_META: Record<Kind, { color: string; light: string; label: string }> = {
  progress:  { color: '#6E89A6', light: '#A9BDD1', label: 'в работе' },
  done:      { color: '#6F9F86', light: '#A9CBB8', label: 'выполнено' },
  overdue:   { color: '#C06B5A', light: '#DDA095', label: 'просрочено' },
  escalated: { color: '#7E57C2', light: '#B39DDB', label: 'эскалация' },
  pending:   { color: '#C9A14A', light: '#E0C589', label: 'ожидает решения' },
};

// 3-цветная «зона» задачи для пузырьков (T-24).
type Health = 'overdue' | 'risk' | 'plan';
const HEALTH: Record<Health, { color: string; label: string }> = {
  overdue: { color: '#C06B5A', label: 'просрочено' },
  risk:    { color: '#C9A14A', label: 'в зоне риска' },
  plan:    { color: '#6F9F86', label: 'в плане' },
};

const TaskPlanDashboard: React.FC = () => {
  const dispatch = useAppDispatch();
  const role = useSelector((s: RootState) => s.auth.role) || '';
  const fullName = useSelector((s: RootState) => s.auth.fullName) || 'Пользователь';
  const proposals = useSelector(selectVisibleProposals, shallowEqual);
  const canManage = role === 'QUALITY_MANAGER';
  const isExec = ['ADMIN', 'CTO', 'CEO', 'CIO', 'EXECUTIVE'].includes(role);

  const [sel, setSel] = useState<Proposal | null>(null);
  const [comment, setComment] = useState('');
  const [escReason, setEscReason] = useState('');
  const [suz, setSuz] = useState('');
  const [owner, setOwner] = useState('');
  const [due, setDue] = useState('');
  const [filter, setFilter] = useState<string>('Активные');
  const [sysFilter, setSysFilter] = useState<string>(ALL_SYS);
  const [listOpen, setListOpen] = useState(true);

  const now = Date.now();
  const kindOf = (t: Proposal): Kind => {
    if (t.execution === 'DONE') return 'done';
    if (t.escalated) return 'escalated';
    if (t.status === 'PENDING_APPROVAL') return 'pending';
    const d = parseRu(t.dueDate);
    if (d && d.getTime() < now) return 'overdue';
    return 'progress';
  };
  // Зона задачи (3 цвета): просрочено / зона риска / в плане.
  const healthOf = (t: Proposal): Health => {
    if (t.execution === 'DONE') return 'plan';
    const d = parseRu(t.dueDate);
    if (!d) return 'plan';
    const daysLeft = Math.round((d.getTime() - now) / DAY);
    if (daysLeft < 0) return 'overdue';
    if (daysLeft <= RISK_DAYS) return 'risk';
    return 'plan';
  };

  // Список систем для фильтра (только по действующим задачам).
  const systems = useMemo(
    () => [...new Set(proposals.filter((p) => p.status !== 'REJECTED').map((p) => p.systemName))].sort(),
    [proposals],
  );

  // База: не отклонённые задачи выбранной системы, отсортированные по сроку.
  const baseTasks = useMemo(
    () => proposals.filter((p) => p.status !== 'REJECTED')
      .filter((p) => sysFilter === ALL_SYS || p.systemName === sysFilter)
      .map((p) => ({ p, kind: kindOf(p) }))
      .sort((a, b) => (parseRu(a.p.dueDate)?.getTime() ?? Infinity) - (parseRu(b.p.dueDate)?.getTime() ?? Infinity)),
    [proposals, sysFilter],
  );
  const counts = useMemo(() => {
    const c: Record<string, number> = { Все: baseTasks.length, Активные: 0, Просрочено: 0, Эскалация: 0, Выполнено: 0 };
    baseTasks.forEach(({ kind }) => {
      if (kind === 'done') c['Выполнено'] += 1;
      else if (kind === 'overdue') c['Просрочено'] += 1;
      else c['Активные'] += 1;
      if (kind === 'escalated') c['Эскалация'] += 1;
    });
    return c;
  }, [baseTasks]);
  const tasks = useMemo(() => baseTasks.filter(({ kind }) =>
    filter === 'Все'
    || (filter === 'Выполнено' && kind === 'done')
    || (filter === 'Просрочено' && kind === 'overdue')
    || (filter === 'Эскалация' && kind === 'escalated')
    || (filter === 'Активные' && kind !== 'done')
  ), [baseTasks, filter]);

  const bounds = useMemo(() => {
    const ts = tasks.flatMap(({ p }) => {
      const s = new Date(p.createdAt).getTime();
      const e = (parseRu(p.dueDate)?.getTime()) ?? s + 30 * DAY;
      return [s, e];
    });
    ts.push(now, now + 45 * DAY, now - 15 * DAY);
    const min = Math.min(...ts), max = Math.max(...ts);
    return { min, max, span: max - min || 1 };
  }, [tasks, now]);
  const months = useMemo(() => {
    const out: { label: string; pct: number }[] = [];
    const d = new Date(bounds.min); d.setDate(1);
    while (d.getTime() <= bounds.max) {
      out.push({ label: d.toLocaleDateString('ru-RU', { month: 'short', year: '2-digit' }), pct: ((d.getTime() - bounds.min) / bounds.span) * 100 });
      d.setMonth(d.getMonth() + 1);
    }
    return out;
  }, [bounds]);
  const todayPct = ((now - bounds.min) / bounds.span) * 100;

  const openTask = (t: Proposal) => {
    setSel(t); setComment(t.topComment || ''); setEscReason(''); setSuz(t.suzLink || ''); setOwner(t.owner || ''); setDue(t.dueDate || '');
  };
  const saveManage = () => { if (!sel) return; dispatch(updateTask({ id: sel.id, suzLink: suz.trim(), owner: owner.trim(), dueDate: due.trim() || undefined })); message.success('Задача обновлена'); setSel(null); };
  const saveComment = () => { if (!sel) return; dispatch(updateTask({ id: sel.id, topComment: comment.trim() })); message.success('Комментарий сохранён'); setSel(null); };
  const doEscalate = () => {
    if (!sel) return;
    if (!escReason.trim()) { message.error('Укажите причину невыполнения/просрочки задачи'); return; }
    dispatch(escalateTask({ id: sel.id, reason: escReason.trim(), by: fullName }));
    message.warning('Эскалировано топ-менеджменту на решение');
    setSel(null);
  };
  const decide = (decision: 'IGNORE' | 'REQUEST_MEASURES') => {
    if (!sel) return;
    dispatch(decideEscalation({ id: sel.id, decision, comment: comment.trim(), by: fullName }));
    message.success(decision === 'IGNORE' ? 'Дано указание игнорировать' : 'Запрошены дополнительные меры');
    setSel(null);
  };
  const resolve = () => { if (!sel) return; dispatch(resolveEscalation({ id: sel.id })); message.success('Эскалация отработана'); setSel(null); };
  const markExec = (status: 'DONE' | 'NOT_DONE') => {
    if (!sel) return;
    if (sel.status !== 'APPROVED') { message.info('Отметка о выполнении доступна для одобренных мер'); return; }
    dispatch(setExecution({ id: sel.id, status, comment: comment.trim() || (status === 'DONE' ? 'Выполнено' : 'Не выполнено'), by: fullName }));
    setSel(null);
  };

  const rowH = 46;
  const filterKeys = ['Активные', 'Просрочено', 'Эскалация', 'Выполнено', 'Все'];

  // Легенда трёх зон (для шапки пузырьковой карты).
  const zoneLegend = (
    <Space size={12} wrap>
      {(Object.keys(HEALTH) as Health[]).map((h) => (
        <Space key={h} size={5}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: HEALTH[h].color, boxShadow: `0 0 6px ${HEALTH[h].color}`, display: 'inline-block' }} />
          <Text type="secondary" style={{ fontSize: 12 }}>{HEALTH[h].label}</Text>
        </Space>
      ))}
    </Space>
  );

  // Колонки списка задач под пузырьковой картой.
  const listColumns = [
    {
      title: 'Тема задачи', key: 'title',
      render: (_: unknown, r: { p: Proposal }) => {
        const h = healthOf(r.p);
        return (
          <Space size={6}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: HEALTH[h].color, boxShadow: `0 0 5px ${HEALTH[h].color}`, display: 'inline-block', flex: '0 0 auto' }} />
            {r.p.escalated && <RiseOutlined style={{ color: '#7E57C2' }} />}
            <Text style={{ color: BRAND.ink }}>{r.p.riskTitle || r.p.metricName}</Text>
          </Space>
        );
      },
    },
    { title: 'Ответственный', key: 'owner', render: (_: unknown, r: { p: Proposal }) => (r.p.owner ? <Text>{r.p.owner}</Text> : <Text type="secondary">не назначен</Text>) },
    {
      title: 'Срок исполнения', key: 'due', width: 160,
      sorter: (a: { p: Proposal }, b: { p: Proposal }) => (parseRu(a.p.dueDate)?.getTime() ?? Infinity) - (parseRu(b.p.dueDate)?.getTime() ?? Infinity),
      render: (_: unknown, r: { p: Proposal }) => {
        const d = parseRu(r.p.dueDate);
        const daysLeft = d ? Math.round((d.getTime() - now) / DAY) : null;
        const color = daysLeft == null ? '#8a94a6' : daysLeft < 0 ? '#C06B5A' : daysLeft <= RISK_DAYS ? '#C9A14A' : '#6F9F86';
        return <Text style={{ color }}>{r.p.dueDate || 'без срока'}</Text>;
      },
    },
  ];

  return (
    <div style={pageContainer}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <Title level={4} style={pageTitle}>
            <ScheduleOutlined style={{ color: GOLD.base, marginRight: 8 }} />План задач по повышению качества
          </Title>
          <Text type="secondary">Формирование и контроль технического долга качества.</Text>
        </div>
        <Space wrap>
          <Text type="secondary"><DatabaseOutlined /> Система:</Text>
          <Select
            value={sysFilter}
            onChange={setSysFilter}
            style={{ minWidth: 210 }}
            showSearch
            optionFilterProp="label"
            options={[{ value: ALL_SYS, label: '— Все системы —' }, ...systems.map((s) => ({ value: s, label: s }))]}
          />
          <Segmented value={filter} onChange={(v) => setFilter(v as string)}
            options={filterKeys.map((k) => ({ label: `${k} (${counts[k] ?? 0})`, value: k }))} />
        </Space>
      </div>

      {/* 1. Читаемая временная диаграмма (Ганта) */}
      <CollapsibleCard
        accent="slate"
        style={{ marginTop: 16 }}
        title="Временная диаграмма"
        subtitle="сроки и статусы задач по времени"
        bodyStyle={{ overflowX: 'auto' }}
      >
        {tasks.length === 0 ? <Empty description="Нет задач в выбранном фильтре." /> : (
          <div style={{ minWidth: 900 }}>
            {/* Шкала месяцев */}
            <div style={{ display: 'flex', height: 22 }}>
              <div style={{ width: LABEL_W, flex: '0 0 auto', fontSize: 12, color: '#8a94a6', fontWeight: 500 }}>Задача · ответственный</div>
              <div style={{ position: 'relative', flex: 1 }}>
                {months.map((m) => (
                  <span key={m.label + m.pct} style={{ position: 'absolute', left: `${m.pct}%`, fontSize: 11, color: '#8a94a6', transform: 'translateX(-50%)' }}>{m.label}</span>
                ))}
              </div>
            </div>

            <div style={{ position: 'relative' }}>
              {/* Линии месяцев + «сегодня» */}
              <div style={{ position: 'absolute', left: LABEL_W, right: 0, top: 0, bottom: 0, pointerEvents: 'none' }}>
                {months.map((m) => (
                  <div key={m.pct} style={{ position: 'absolute', left: `${m.pct}%`, top: 0, bottom: 0, borderLeft: '1px dashed #EAECEF' }} />
                ))}
                {todayPct >= 0 && todayPct <= 100 && (
                  <div style={{ position: 'absolute', left: `${todayPct}%`, top: -2, bottom: 0, borderLeft: '2px solid #C06B5A' }}>
                    <span style={{ position: 'absolute', top: -16, left: -20, fontSize: 10, color: '#C06B5A', fontWeight: 600 }}>сегодня</span>
                  </div>
                )}
              </div>

              {tasks.map(({ p, kind }, idx) => {
                const start = new Date(p.createdAt).getTime();
                const dueDate = parseRu(p.dueDate);
                const end = dueDate?.getTime() ?? start + 30 * DAY;
                const left = ((start - bounds.min) / bounds.span) * 100;
                const width = Math.max(3, ((end - start) / bounds.span) * 100);
                const meta = KIND_META[kind];
                const daysLeft = dueDate ? Math.round((dueDate.getTime() - now) / DAY) : null;
                const dl = daysLeft == null ? null
                  : daysLeft < 0 ? { t: `−${-daysLeft}д`, c: '#C06B5A' }
                  : daysLeft <= 7 ? { t: `${daysLeft}д`, c: '#C9A14A' }
                  : { t: `${daysLeft}д`, c: '#8a94a6' };
                return (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', height: rowH, background: idx % 2 ? '#FAFBFC' : '#fff' }}>
                    <div style={{ width: LABEL_W, flex: '0 0 auto', paddingRight: 12, overflow: 'hidden' }}>
                      <Tooltip title={`${p.riskTitle || p.metricName} · ${p.characteristic}`}>
                        <div style={{ fontSize: 13, color: BRAND.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {p.escalated && <RiseOutlined style={{ color: '#7E57C2', marginRight: 4 }} />}{p.riskTitle || p.metricName}
                        </div>
                      </Tooltip>
                      <div style={{ fontSize: 11, color: '#8a94a6', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.owner || 'ответственный не назначен'}
                      </div>
                    </div>
                    <div style={{ position: 'relative', flex: 1, height: '100%' }}>
                      <Tooltip title={<span>{fmt(new Date(p.createdAt))} → {p.dueDate || 'без срока'} · {meta.label}{p.suzLink ? ' · есть задача в СУЗ' : ''}</span>}>
                        <div
                          onClick={() => openTask(p)}
                          style={{
                            position: 'absolute', top: (rowH - 26) / 2, left: `${left}%`, width: `${width}%`, height: 26,
                            background: `linear-gradient(180deg, ${meta.light}, ${meta.color})`, borderRadius: 13, cursor: 'pointer',
                            display: 'flex', alignItems: 'center', paddingLeft: 10, paddingRight: 10, color: '#fff', fontSize: 11, gap: 6,
                            boxShadow: '0 1px 3px rgba(0,0,0,.15)', border: kind === 'escalated' ? '1.5px solid #5E35B1' : 'none',
                          }}
                        >
                          {/* стартовая точка */}
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#fff', flex: '0 0 auto', marginLeft: -2 }} />
                          {p.suzLink && <LinkOutlined />}
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.dueDate || 'без срока'}</span>
                        </div>
                      </Tooltip>
                      {/* флажок дедлайна + осталось дней */}
                      {dl && kind !== 'done' && (
                        <span style={{
                          position: 'absolute', top: (rowH - 18) / 2, left: `calc(${left + width}% + 6px)`, height: 18,
                          fontSize: 10, fontWeight: 600, color: dl.c, background: '#fff', border: `1px solid ${dl.c}`,
                          borderRadius: 9, padding: '0 7px', display: 'flex', alignItems: 'center', whiteSpace: 'nowrap',
                        }}>{dl.t}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <Space size={16} style={{ marginTop: 14 }} wrap>
              {(Object.keys(KIND_META) as Kind[]).map((k) => (
                <Space key={k} size={5}><span style={{ width: 14, height: 10, background: `linear-gradient(180deg, ${KIND_META[k].light}, ${KIND_META[k].color})`, borderRadius: 5, display: 'inline-block' }} /><Text type="secondary" style={{ fontSize: 12 }}>{KIND_META[k].label}</Text></Space>
              ))}
            </Space>
          </div>
        )}
      </CollapsibleCard>

      {/* 2. Пузырьковая карта задач (T-24) */}
      <CollapsibleCard
        accent="gold"
        style={{ marginTop: 16 }}
        title="Пузырьковая карта задач"
        subtitle="ось Y — ответственные · X — срок исполнения · цвет = зона · совпавшие даты собираются в пирог (наведите, чтобы разъехались)"
        extra={zoneLegend}
      >
        {tasks.length === 0 ? <Empty description="Нет задач в выбранном фильтре." /> : (
          <>
            <TaskBubbleTimeline tasks={tasks} onOpen={openTask} />

            {/* Сворачиваемый список задач под диаграммой */}
            <div style={{ marginTop: 8, borderTop: '1px solid #EEF0F2', paddingTop: 10 }}>
              <div
                role="button"
                tabIndex={0}
                onClick={() => setListOpen(!listOpen)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setListOpen(!listOpen); } }}
                style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none', marginBottom: listOpen ? 8 : 0 }}
              >
                <DownOutlined style={{ fontSize: 12, color: BRAND.inkSoft, transition: 'transform .25s ease', transform: listOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }} />
                <span style={accentDot(GOLD.base)} />
                <UnorderedListOutlined style={{ color: BRAND.inkSoft }} />
                <Text strong style={{ color: BRAND.ink }}>Список задач ({tasks.length})</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>· клик по строке — открыть задачу</Text>
              </div>
              {listOpen && (
                <Table
                  dataSource={tasks}
                  columns={listColumns as any}
                  rowKey={(r) => r.p.id}
                  size="small"
                  pagination={tasks.length > 10 ? { pageSize: 10, size: 'small' } : false}
                  onRow={(r) => ({ onClick: () => openTask(r.p), style: { cursor: 'pointer' } })}
                />
              )}
            </div>
          </>
        )}
      </CollapsibleCard>

      <Modal open={!!sel} onCancel={() => setSel(null)} footer={null} width={640} title={sel ? (sel.riskTitle || sel.metricName) : ''}>
        {sel && (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Space wrap>
              <Tag>{sel.characteristic}</Tag>
              <Tag color={sel.status === 'APPROVED' ? 'green' : sel.status === 'REJECTED' ? 'red' : 'gold'}>{sel.status}</Tag>
              {sel.execution === 'DONE' && <Tag color="green">выполнено</Tag>}
              {sel.escalated && <Tag color="purple">эскалирована</Tag>}
            </Space>
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

            {/* ── Менеджер по качеству ── */}
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
                </Space>

                {/* Эскалация (инициирует только QM) / отработка после решения */}
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

            {/* ── Топ-менеджмент ── */}
            {isExec && (
              <>
                {sel.escalated && !sel.escalationDecision ? (
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
                )}
              </>
            )}
            {!isExec && !canManage && sel.topComment && (
              <div><Text type="secondary">Комментарий топ-менеджера:</Text><Paragraph style={{ marginBottom: 0 }}>{sel.topComment}</Paragraph></div>
            )}
          </Space>
        )}
      </Modal>
    </div>
  );
};

export default TaskPlanDashboard;
