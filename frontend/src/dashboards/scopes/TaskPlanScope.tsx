/**
 * TaskPlanScope.tsx — общее состояние карточек «Плана задач по повышению качества».
 *
 * Диаграмма Ганта, пузырьковая карта и список задач смотрят в ОДНУ выборку: фильтры по системе,
 * характеристике, ответственному (УК-14) и статусу задают её здесь и выведены в панель над сеткой.
 * Карточку задачи со всеми действиями (управление, эскалация, решение топ-менеджмента, отметка
 * о выполнении, переписывание для исполнителя) рендерит этот же провайдер — её открывают все три
 * карточки, а сама она живёт в components/TaskPlanTaskModal.
 */
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Segmented, Select, Space, Typography } from 'antd';
import { DatabaseOutlined, FlagOutlined, UserOutlined } from '@ant-design/icons';
import { useSearchParams } from 'react-router-dom';
import { useSelector, shallowEqual } from 'react-redux';
import type { RootState } from '../../store';
import { selectVisibleProposals, type Proposal } from '../../store/slices/governanceSlice';
import { RAG, ACCENT } from '../../theme/ragPalette';
import TaskPlanTaskModal from '../../components/TaskPlanTaskModal';

const { Text } = Typography;

export const DAY = 86400000;
export const LABEL_W = 300;
/** «Зона риска» — до срока осталось ≤ 14 дней. */
export const RISK_DAYS = 14;
const ALL_SYS = '__ALL__';
const ALL_CHAR = '__ALL__';
const ALL_OWNER = '__ALL__';

const parseRu = (d?: string): Date | null => {
  if (!d) return null;
  const m = /(\d{2})\.(\d{2})\.(\d{4})/.exec(d);
  return m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])) : null;
};
/** ТЗ v19 УК-36: срок — из реального `dueOn` (ISO), в демо его нет — честно парсим строку. */
export const dueDateOf = (p: Proposal): Date | null => {
  if (p.dueOn) {
    const d = new Date(p.dueOn);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return parseRu(p.dueDate);
};
export const fmt = (d: Date) => d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });

export type Kind = 'done' | 'overdue' | 'escalated' | 'progress' | 'pending';
/** `color`/`light` — маркеры и легенда (графика, ≥3:1). `bar`/`barEnd` — заливка полосы Ганта
 *  под БЕЛЫМ текстом: пастельный градиент давал ≈1.8:1 и текст пропадал (T-57). */
export const KIND_META: Record<Kind, { color: string; light: string; bar: string; barEnd: string; label: string }> = {
  progress:  { color: ACCENT.slate.color, light: '#A9BDD1', bar: ACCENT.slate.strong, barEnd: '#47678B', label: 'в работе' },
  done:      { color: RAG.good.color, light: '#A9CBB8', bar: '#4C8165', barEnd: '#3E6C54', label: 'выполнено' },
  overdue:   { color: RAG.bad.color, light: '#DDA095', bar: '#C0553F', barEnd: '#A64733', label: 'просрочено' },
  escalated: { color: ACCENT.violet.color, light: '#B39DDB', bar: ACCENT.violet.color, barEnd: ACCENT.violet.strong, label: 'эскалация' },
  pending:   { color: RAG.medium.color, light: '#E0C589', bar: '#947125', barEnd: '#7C5E1E', label: 'ожидает решения' },
};

export type Health = 'overdue' | 'risk' | 'plan';
export const HEALTH: Record<Health, { color: string; label: string }> = {
  overdue: { color: RAG.bad.color, label: 'просрочено' },
  risk:    { color: RAG.medium.color, label: 'в зоне риска' },
  plan:    { color: RAG.good.color, label: 'в плане' },
};

export interface TaskRow { p: Proposal; kind: Kind }

interface TaskPlanScopeValue {
  now: number;
  tasks: TaskRow[];
  baseTasks: TaskRow[];
  bounds: { min: number; max: number; span: number };
  months: { label: string; pct: number }[];
  todayPct: number;
  healthOf: (t: Proposal) => Health;
  openTask: (t: Proposal) => void;
  ganttOpen: boolean;
  setGanttOpen: (v: boolean) => void;
  setOwnerFilter: (o: string) => void;
  setFilter: (f: string) => void;
}

const Ctx = createContext<TaskPlanScopeValue | null>(null);

export function useTaskPlanScope(): TaskPlanScopeValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('Карточка «Плана задач» отрисована вне TaskPlanScope');
  return v;
}

interface FiltersValue {
  systems: string[]; characteristics: string[]; owners: string[];
  sysFilter: string; setSysFilter: (v: string) => void;
  charFilter: string; setCharFilter: (v: string) => void;
  ownerFilter: string; setOwnerFilter: (v: string) => void;
  filter: string; setFilter: (v: string) => void;
  counts: Record<string, number>;
}
const FiltersCtx = createContext<FiltersValue | null>(null);

const FILTER_KEYS = ['Активные', 'Просрочено', 'Эскалация', 'Выполнено', 'Все'];

export const TaskPlanScopeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const proposals = useSelector(selectVisibleProposals, shallowEqual);

  const [sel, setSel] = useState<Proposal | null>(null);
  const [filter, setFilter] = useState<string>('Активные');
  const [sysFilter, setSysFilter] = useState<string>(ALL_SYS);
  const [charFilter, setCharFilter] = useState<string>(ALL_CHAR);
  const [ownerFilter, setOwnerFilter] = useState<string>(ALL_OWNER);
  const [searchParams, setSearchParams] = useSearchParams();
  const [ganttOpen, setGanttOpen] = useState(true);

  // Переход из «AI-аналитики по мерам» (?characteristic=) и «Эффективности сотрудников»
  // (?owner=&status=) — параметры одноразовые.
  useEffect(() => {
    const c = searchParams.get('characteristic');
    const o = searchParams.get('owner');
    const st = searchParams.get('status');
    if (c || o || st) {
      if (c) setCharFilter(c);
      if (o) setOwnerFilter(o);
      if (st) setFilter(st);
      setSearchParams((sp) => { sp.delete('characteristic'); sp.delete('owner'); sp.delete('status'); return sp; }, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const now = Date.now();
  const kindOf = (t: Proposal): Kind => {
    if (t.execution === 'DONE') return 'done';
    if (t.escalated) return 'escalated';
    if (t.status === 'PENDING_APPROVAL') return 'pending';
    const d = dueDateOf(t);
    if (d && d.getTime() < now) return 'overdue';
    return 'progress';
  };
  const healthOf = (t: Proposal): Health => {
    if (t.execution === 'DONE') return 'plan';
    const d = dueDateOf(t);
    if (!d) return 'plan';
    const daysLeft = Math.round((d.getTime() - now) / DAY);
    if (daysLeft < 0) return 'overdue';
    if (daysLeft <= RISK_DAYS) return 'risk';
    return 'plan';
  };

  /** Уникальные непустые значения поля по действующим (не отклонённым) мерам. */
  const distinctOf = (pick: (p: Proposal) => string | undefined): string[] => {
    const seen: string[] = [];
    proposals.forEach((p) => {
      if (p.status === 'REJECTED') return;
      const v = pick(p);
      if (v && !seen.includes(v)) seen.push(v);
    });
    return seen.sort();
  };

  const systems = useMemo(() => distinctOf((p) => p.systemName), [proposals]);
  const characteristics = useMemo(() => distinctOf((p) => p.characteristic), [proposals]);
  const owners = useMemo(() => distinctOf((p) => p.owner), [proposals]);

  const baseTasks = useMemo(
    () => proposals.filter((p) => p.status !== 'REJECTED')
      .filter((p) => sysFilter === ALL_SYS || p.systemName === sysFilter)
      .filter((p) => charFilter === ALL_CHAR || p.characteristic === charFilter)
      .filter((p) => ownerFilter === ALL_OWNER || p.owner === ownerFilter)
      .map((p) => ({ p, kind: kindOf(p) }))
      .sort((a, b) => (dueDateOf(a.p)?.getTime() ?? Infinity) - (dueDateOf(b.p)?.getTime() ?? Infinity)),
    [proposals, sysFilter, charFilter, ownerFilter],
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
      const e = (dueDateOf(p)?.getTime()) ?? s + 30 * DAY;
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

  const openTask = setSel;

  const value: TaskPlanScopeValue = {
    now, tasks, baseTasks, bounds, months, todayPct, healthOf, openTask,
    ganttOpen, setGanttOpen, setOwnerFilter, setFilter,
  };
  const filters: FiltersValue = {
    systems, characteristics, owners,
    sysFilter, setSysFilter, charFilter, setCharFilter, ownerFilter, setOwnerFilter,
    filter, setFilter, counts,
  };

  return (
    <FiltersCtx.Provider value={filters}>
      <Ctx.Provider value={value}>
        {children}
        <TaskPlanTaskModal proposal={sel} onClose={() => setSel(null)} onReplace={setSel} />
      </Ctx.Provider>
    </FiltersCtx.Provider>
  );
};

export const TaskPlanScopeToolbar: React.FC = () => {
  const f = useContext(FiltersCtx);
  if (!f) return null;
  return (
    <Space wrap size={12}>
      <Text type="secondary"><DatabaseOutlined /> Система:</Text>
      <Select
        value={f.sysFilter} onChange={f.setSysFilter} style={{ minWidth: 200 }} showSearch optionFilterProp="label"
        options={[{ value: ALL_SYS, label: '— Все системы —' }, ...f.systems.map((s) => ({ value: s, label: s }))]}
      />
      <Text type="secondary"><FlagOutlined /> Характеристика:</Text>
      <Select
        value={f.charFilter} onChange={f.setCharFilter} style={{ minWidth: 200 }} showSearch optionFilterProp="label"
        options={[{ value: ALL_CHAR, label: '— Все характеристики —' }, ...f.characteristics.map((c) => ({ value: c, label: c }))]}
      />
      <Text type="secondary"><UserOutlined /> Ответственный:</Text>
      <Select
        value={f.ownerFilter} onChange={f.setOwnerFilter} style={{ minWidth: 200 }} showSearch optionFilterProp="label"
        options={[{ value: ALL_OWNER, label: '— Все ответственные —' }, ...f.owners.map((o) => ({ value: o, label: o }))]}
      />
      <Segmented
        value={f.filter} onChange={(v) => f.setFilter(v as string)}
        options={FILTER_KEYS.map((k) => ({ label: `${k} (${f.counts[k] ?? 0})`, value: k }))}
      />
    </Space>
  );
};
