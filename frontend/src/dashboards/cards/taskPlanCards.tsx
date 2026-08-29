/**
 * taskPlanCards.tsx — карточки «Плана задач по повышению качества».
 *
 * Гант и пузырьковая карта были CollapsibleCard: их сворачивали, чтобы страница не была
 * бесконечной. В сетке эту роль играет сама ячейка — карточку можно уменьшить или убрать, —
 * поэтому обёртка-аккордеон убрана, а внутренняя разметка перенесена как есть.
 */
import React, { useState } from 'react';
import { Empty, Space, Table, Tooltip, Typography } from 'antd';
import { LinkOutlined, RiseOutlined, DownOutlined, UnorderedListOutlined } from '@ant-design/icons';
import { BRAND, RAG, ACCENT } from '../../theme/ragPalette';
import { GOLD, accentDot, SPACE, TYPE, PREMIUM } from '../../theme/premium';
import { sorterFor } from '../../theme/table';
import TaskBubbleTimeline from '../../components/TaskBubbleTimeline';
import EmployeeEffectivenessCard from '../../components/EmployeeEffectivenessCard';
import type { Proposal } from '../../store/slices/governanceSlice';
import {
  useTaskPlanScope, KIND_META, HEALTH, dueDateOf, fmt, DAY, LABEL_W, RISK_DAYS,
  type Kind, type Health,
} from '../scopes/TaskPlanScope';
import GridCard, { FillCard } from '../GridCard';

const { Text } = Typography;

// ─────────────────── Эффективность сотрудников ───────────────────

export const TaskPlanEmployeesCard: React.FC = () => {
  const { baseTasks, setOwnerFilter, setFilter, setGanttOpen } = useTaskPlanScope();
  return (
    <FillCard>
      <EmployeeEffectivenessCard
        proposals={baseTasks.map(({ p }) => p)}
        onSelectOwner={(o, status) => { setOwnerFilter(o); if (status) setFilter(status); setGanttOpen(true); }}
      />
    </FillCard>
  );
};

// ─────────────────── Временная диаграмма (Ганта) ───────────────────

export const TaskPlanGanttCard: React.FC = () => {
  const { tasks, bounds, months, todayPct, now, openTask } = useTaskPlanScope();
  return (
    <GridCard accent="slate" title="Временная диаграмма" hint="сроки и статусы задач по времени">
      {tasks.length === 0 ? <Empty description="Нет задач в выбранном фильтре." /> : (
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 900 }}>
            <div style={{ display: 'flex', height: 22 }}>
              <div style={{ width: LABEL_W, flex: '0 0 auto', fontSize: TYPE.caption.fontSize, color: BRAND.inkSoft, fontWeight: 500 }}>Задача · ответственный</div>
              <div style={{ position: 'relative', flex: 1 }}>
                {months.map((m) => (
                  <span key={m.label + m.pct} style={{ position: 'absolute', left: `${m.pct}%`, fontSize: TYPE.micro.fontSize, color: BRAND.inkSoft, transform: 'translateX(-50%)' }}>{m.label}</span>
                ))}
              </div>
            </div>

            <div style={{ position: 'relative' }}>
              <div style={{ position: 'absolute', left: LABEL_W, right: 0, top: 0, bottom: 0, pointerEvents: 'none' }}>
                {months.map((m) => (
                  <div key={m.pct} style={{ position: 'absolute', left: `${m.pct}%`, top: 0, bottom: 0, borderLeft: `1px dashed ${PREMIUM.border}` }} />
                ))}
                {todayPct >= 0 && todayPct <= 100 && (
                  <div style={{ position: 'absolute', left: `${todayPct}%`, top: -2, bottom: 0, borderLeft: `2px solid ${RAG.bad.strong}` }}>
                    <span style={{ position: 'absolute', top: -16, left: -20, fontSize: TYPE.micro.fontSize, color: RAG.bad.strong, fontWeight: 600 }}>сегодня</span>
                  </div>
                )}
              </div>

              {tasks.map(({ p, kind }, idx) => {
                const rowH = 46;
                const start = new Date(p.createdAt).getTime();
                const dueDate = dueDateOf(p);
                const end = dueDate?.getTime() ?? start + 30 * DAY;
                const left = ((start - bounds.min) / bounds.span) * 100;
                const width = Math.max(3, ((end - start) / bounds.span) * 100);
                const meta = KIND_META[kind];
                const daysLeft = dueDate ? Math.round((dueDate.getTime() - now) / DAY) : null;
                const dl = daysLeft == null ? null
                  : daysLeft < 0 ? { t: `−${-daysLeft}д`, c: RAG.bad.strong }
                  : daysLeft <= 7 ? { t: `${daysLeft}д`, c: RAG.medium.strong }
                  : { t: `${daysLeft}д`, c: BRAND.inkSoft };
                return (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', height: rowH, background: idx % 2 ? BRAND.surfaceSoft : BRAND.surface }}>
                    <div style={{ width: LABEL_W, flex: '0 0 auto', paddingRight: 12, overflow: 'hidden' }}>
                      <Tooltip title={`${p.riskTitle || p.metricName} · ${p.characteristic}`}>
                        <div style={{ fontSize: TYPE.bodySm.fontSize, color: BRAND.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {p.escalated && <RiseOutlined style={{ color: ACCENT.violet.color, marginRight: 4 }} />}{p.riskTitle || p.metricName}
                        </div>
                      </Tooltip>
                      <div style={{ fontSize: TYPE.micro.fontSize, color: BRAND.inkSoft, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.owner || 'ответственный не назначен'}
                      </div>
                    </div>
                    <div style={{ position: 'relative', flex: 1, height: '100%' }}>
                      <Tooltip title={<span>{fmt(new Date(p.createdAt))} → {p.dueDate || 'без срока'} · {meta.label}{p.suzLink ? ' · есть задача в СУЗ' : ''}</span>}>
                        <div
                          onClick={() => openTask(p)}
                          style={{
                            position: 'absolute', top: (rowH - 26) / 2, left: `${left}%`, width: `${width}%`, height: 26,
                            background: `linear-gradient(180deg, ${meta.bar}, ${meta.barEnd})`, borderRadius: 13, cursor: 'pointer',
                            display: 'flex', alignItems: 'center', paddingLeft: SPACE.cozy, paddingRight: SPACE.cozy,
                            color: '#fff', fontSize: TYPE.micro.fontSize, gap: SPACE.snug,
                            boxShadow: '0 1px 3px rgba(0,0,0,.15)', border: kind === 'escalated' ? '1.5px solid #5E35B1' : 'none',
                          }}
                        >
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#fff', flex: '0 0 auto', marginLeft: -2 }} />
                          {p.suzLink && <LinkOutlined />}
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.dueDate || 'без срока'}</span>
                        </div>
                      </Tooltip>
                      {dl && kind !== 'done' && (
                        <span style={{
                          position: 'absolute', top: (rowH - 18) / 2, left: `calc(${left + width}% + 6px)`, height: 18,
                          fontSize: TYPE.micro.fontSize, fontWeight: 600, color: dl.c, background: BRAND.surface, border: `1px solid ${dl.c}`,
                          borderRadius: 8, padding: `0 ${SPACE.snug}px`, display: 'flex', alignItems: 'center', whiteSpace: 'nowrap',
                        }}>{dl.t}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <Space size={SPACE.base} style={{ marginTop: SPACE.base }} wrap>
              {(Object.keys(KIND_META) as Kind[]).map((k) => (
                <Space key={k} size={5}>
                  <span style={{ width: 14, height: 10, background: `linear-gradient(180deg, ${KIND_META[k].light}, ${KIND_META[k].color})`, borderRadius: 5, display: 'inline-block' }} />
                  <Text type="secondary" style={TYPE.caption}>{KIND_META[k].label}</Text>
                </Space>
              ))}
            </Space>
          </div>
        </div>
      )}
    </GridCard>
  );
};

// ─────────────────── Пузырьковая карта задач + список ───────────────────

export const TaskPlanBubblesCard: React.FC = () => {
  const { tasks, openTask, healthOf, now } = useTaskPlanScope();
  const [listOpen, setListOpen] = useState(false);

  const zoneLegend = (
    <Space size={12} wrap>
      {(Object.keys(HEALTH) as Health[]).map((h) => (
        <Space key={h} size={5}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: HEALTH[h].color, boxShadow: `0 0 6px ${HEALTH[h].color}`, display: 'inline-block' }} />
          <Text type="secondary" style={TYPE.caption}>{HEALTH[h].label}</Text>
        </Space>
      ))}
    </Space>
  );

  const listColumns = [
    {
      title: 'Тема задачи', key: 'title',
      sorter: sorterFor((r: { p: Proposal }) => r.p.riskTitle || r.p.metricName),
      render: (_: unknown, r: { p: Proposal }) => {
        const h = healthOf(r.p);
        return (
          <Space size={6}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: HEALTH[h].color, boxShadow: `0 0 5px ${HEALTH[h].color}`, display: 'inline-block', flex: '0 0 auto' }} />
            {r.p.escalated && <RiseOutlined style={{ color: ACCENT.violet.color }} />}
            <Text style={{ color: BRAND.ink }}>{r.p.riskTitle || r.p.metricName}</Text>
          </Space>
        );
      },
    },
    { title: 'Ответственный', key: 'owner', sorter: sorterFor((r: { p: Proposal }) => r.p.owner),
      render: (_: unknown, r: { p: Proposal }) => (r.p.owner ? <Text>{r.p.owner}</Text> : <Text type="secondary">не назначен</Text>) },
    {
      title: 'Срок исполнения', key: 'due', width: 160,
      sorter: (a: { p: Proposal }, b: { p: Proposal }) => (dueDateOf(a.p)?.getTime() ?? Infinity) - (dueDateOf(b.p)?.getTime() ?? Infinity),
      render: (_: unknown, r: { p: Proposal }) => {
        const d = dueDateOf(r.p);
        const daysLeft = d ? Math.round((d.getTime() - now) / DAY) : null;
        const color = daysLeft == null ? BRAND.inkSoft
          : daysLeft < 0 ? RAG.bad.strong : daysLeft <= RISK_DAYS ? RAG.medium.strong : RAG.good.strong;
        return <Text style={{ color }}>{r.p.dueDate || 'без срока'}</Text>;
      },
    },
  ];

  return (
    <GridCard
      accent="gold"
      dotColor={GOLD.base}
      title="Пузырьковая карта задач"
      hint="Y — ответственные · X — срок · цвет = зона"
      extra={zoneLegend}
    >
      {tasks.length === 0 ? <Empty description="Нет задач в выбранном фильтре." /> : (
        <>
          <TaskBubbleTimeline tasks={tasks} onOpen={openTask} />
          <div style={{ marginTop: SPACE.snug, borderTop: `1px solid ${PREMIUM.border}`, paddingTop: SPACE.cozy }}>
            <div
              role="button"
              tabIndex={0}
              onClick={() => setListOpen(!listOpen)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setListOpen(!listOpen); } }}
              style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none', marginBottom: listOpen ? 8 : 0 }}
            >
              <DownOutlined style={{ fontSize: TYPE.caption.fontSize, color: BRAND.inkSoft, transition: 'transform .25s ease', transform: listOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }} />
              <span style={accentDot(GOLD.base)} />
              <UnorderedListOutlined style={{ color: BRAND.inkSoft }} />
              <Text strong style={{ color: BRAND.ink }}>Список задач ({tasks.length})</Text>
              <Text type="secondary" style={TYPE.caption}>· клик по строке — открыть задачу</Text>
            </div>
            {listOpen && (
              <Table
                dataSource={tasks}
                columns={listColumns as any}
                rowKey={(r) => r.p.id}
                size="small"
                pagination={tasks.length > 10 ? { pageSize: 10, size: 'small' } : false}
                locale={{ emptyText: 'Задач по выбранным фильтрам нет' }}
                onRow={(r) => ({ onClick: () => openTask(r.p), style: { cursor: 'pointer' } })}
              />
            )}
          </div>
        </>
      )}
    </GridCard>
  );
};
