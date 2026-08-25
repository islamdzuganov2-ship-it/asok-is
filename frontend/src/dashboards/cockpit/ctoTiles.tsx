/**
 * ctoTiles.tsx — реестр плиток кокпита CTO (ТЗ v21 §6). Линза по умолчанию — 'score'.
 *
 * Очередь решений (6.1) читает Redux (`selectVisibleProposals`), а не отдельный fetch: те же
 * меры, что уже синхронизирует `syncProposals` (AppLayout), и то же решение — через уже
 * существующий `MeasureDecisionModal` (SoD проверяется на сервере, как сейчас).
 */
import React, { useState } from 'react';
import { Table, Typography, Space } from 'antd';
import { Link } from 'react-router-dom';
import { RightOutlined } from '@ant-design/icons';
import { useSelector, shallowEqual } from 'react-redux';
import { selectVisibleProposals, type Proposal } from '../../store/slices/governanceSlice';
import { MeasureDecisionModal } from '../../components/MeasureDecisionModal';
import type { CockpitTile, TileValue, Tone } from './types';
import type { Slice } from '../../store/slice/sliceTypes';
import { CRITICALITY_TO_CLASS } from '../../store/slice/sliceTypes';
import { useCockpitFetch } from './useCockpitData';
import { qs } from '../../utils/apiFetch';
import { fmtMoneyCompact } from '../../utils/money';
import { useGetSystemsQuery } from '../../store/api/apiSlice';

const { Text } = Typography;

interface PortfolioTrend {
  metric: string; points: { period: string; value: number }[];
  deltaAbsolute: number | null; deltaRelative: number | null; anomaly: boolean; emptyReason: string | null;
}
interface IncidentAnalytics {
  total: number; openCount: number; resolvedCount: number; avgMttrHours: number | null;
  windowHours: number | null; mtbfHours: number | null; availabilityPct: number | null;
  byCategory: { category: string; count: number; openCount: number; avgMttrHours: number | null }[];
}
interface TriggeredRisk {
  id: string; code: string; title: string; characteristic?: string | null;
  triggeredBy: string; owner?: string | null;
}
interface ManagerRow {
  owner: string; openCount: number; overdueCount: number; completedCount: number; deltaAleManaged: number;
}
interface ManagerMetrics { mode: string; note: string; rows: ManagerRow[] }

function sysParam(slice: Slice): string | undefined {
  return slice.systems.length === 1 ? slice.systems[0] : undefined;
}
/**
 * Redux governanceSlice хранит проданные (denormalized) записи по ИМЕНИ системы (`systemName`),
 * а разрез (Slice) — по id (общий формат для всех дашбордов). Резолвим id → имя через уже
 * загруженный список систем, иначе фильтр по разрезу молча ничего не находил бы.
 */
function useSliceSystemNames(slice: Slice): Set<string> | null {
  const { data } = useGetSystemsQuery();
  if (!slice.systems.length) return null;
  const idSet = new Set(slice.systems);
  return new Set((data?.items ?? []).filter((s) => idSet.has(s.id)).map((s) => s.name));
}
/** `/risks/triggered?system=` и `/incidents/analytics?system=` тоже фильтруют по ИМЕНИ. */
function useSingleSystemName(slice: Slice): string | undefined {
  const { data } = useGetSystemsQuery();
  if (slice.systems.length !== 1) return undefined;
  return data?.items.find((s) => s.id === slice.systems[0])?.name;
}
function critParam(slice: Slice): string | undefined {
  return slice.criticality.length === 1 ? CRITICALITY_TO_CLASS[slice.criticality[0]] : undefined;
}
function l3Link(href: string, label: string) {
  return (
    <div style={{ marginTop: 12 }}>
      <Link to={href}>{label} <RightOutlined style={{ fontSize: 11 }} /></Link>
    </div>
  );
}

function detailTable<T>(rows: T[], columns: any[], empty: string, l3?: { href: string; label: string }) {
  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      {rows.length
        ? <Table size="small" dataSource={rows} columns={columns} rowKey={(r: any) => r.id ?? r.owner ?? r.code} pagination={{ pageSize: 7 }} scroll={{ x: 'max-content' }} />
        : <Text type="secondary">{empty}</Text>}
      {l3 && l3Link(l3.href, l3.label)}
    </Space>
  );
}

// ── 6.1 «Что ждёт моего решения?» ──
const DecisionQueueTile: CockpitTile = {
  id: 'cto-decisions',
  question: 'Что ждёт моего решения?',
  perm: 'view.dashboard.cto',
  defaultEnabled: true,
  useValue(slice): TileValue {
    const proposals = useSelector(selectVisibleProposals, shallowEqual);
    const names = useSliceSystemNames(slice);
    let pending = proposals.filter((p) => p.status === 'PENDING_APPROVAL');
    if (names) pending = pending.filter((p) => names.has(p.systemName));
    if (slice.characteristic) pending = pending.filter((p) => p.characteristic === slice.characteristic);
    if (!pending.length) return { value: 0, tone: 'high', subtitle: 'Очередь пуста' };
    const sumDelta = pending.reduce((a, p) => a + (p.deltaAleCash ?? 0), 0);
    const now = Date.now();
    const overdue = pending.filter((p) => p.dueOn && new Date(p.dueOn).getTime() < now).length;
    const tone: Tone = overdue ? 'critical' : pending.length > 5 ? 'medium' : 'high';
    return {
      value: pending.length, unit: 'шт.', tone,
      subtitle: overdue
        ? `${overdue} горит · снимают ${fmtMoneyCompact(sumDelta)}/год`
        : `в пределах срока · снимают ${fmtMoneyCompact(sumDelta)}/год`,
    };
  },
  Detail({ slice }) {
    const proposals = useSelector(selectVisibleProposals, shallowEqual);
    const names = useSliceSystemNames(slice);
    const [active, setActive] = useState<Proposal | null>(null);
    let pending = proposals.filter((p) => p.status === 'PENDING_APPROVAL');
    if (names) pending = pending.filter((p) => names.has(p.systemName));
    if (slice.characteristic) pending = pending.filter((p) => p.characteristic === slice.characteristic);
    return (
      <>
        {detailTable(
          pending,
          [
            { title: 'Мера', dataIndex: 'rationale', ellipsis: true, width: 260 },
            { title: 'ИС', dataIndex: 'systemName' },
            { title: 'Характеристика', dataIndex: 'characteristic' },
            { title: 'ΔALE, ₽/год', dataIndex: 'deltaAleCash', render: (v?: number) => fmtMoneyCompact(v ?? null) },
            {
              title: '', dataIndex: 'id',
              render: (_: string, p: Proposal) => <a onClick={() => setActive(p)}>решить →</a>,
            },
          ],
          'Очередь пуста',
          { href: '/dashboard/taskplan?from=cockpit&role=cto', label: 'План задач' },
        )}
        <MeasureDecisionModal open={!!active} proposal={active} onClose={() => setActive(null)} />
      </>
    );
  },
};

// ── 6.2 «Что просело за период?» ──
const DegradedTile: CockpitTile = {
  id: 'cto-degraded',
  question: 'Что просело за период?',
  perm: 'view.dashboard.dynamics',
  defaultEnabled: true,
  useValue(slice): TileValue {
    const { data, loading } = useCockpitFetch<PortfolioTrend>(
      `/econ/portfolio-trend${qs({ metric: 'score', system_id: sysParam(slice) })}`,
    );
    if (loading) return { value: null, tone: 'neutral', subtitle: '', loading: true };
    if (!data || data.emptyReason || data.points.length < 2) {
      return { value: null, tone: 'neutral', subtitle: '', empty: { reason: data?.emptyReason ?? 'Недостаточно периодов для сравнения' } };
    }
    const delta = data.deltaAbsolute ?? 0;
    const tone: Tone = data.anomaly ? 'critical' : delta < 0 ? 'medium' : 'high';
    return {
      value: `${delta > 0 ? '+' : ''}${delta}`, unit: 'п.п.', tone,
      trend: data.points.map((p) => p.value),
      delta: { value: delta, unit: ' п.п.', direction: delta >= 0 ? 'up' : 'down' },
      subtitle: data.anomaly ? 'Аномальное изменение (≥12 п.п.) — требует зафиксированной причины' : 'В пределах обычных колебаний',
    };
  },
  Detail({ slice }) {
    const { data } = useCockpitFetch<PortfolioTrend>(`/econ/portfolio-trend${qs({ metric: 'score', system_id: sysParam(slice) })}`);
    return detailTable(
      data?.points ?? [],
      [{ title: 'Период', dataIndex: 'period' }, { title: 'Балл (среднее по портфелю)', dataIndex: 'value' }],
      'Нет истории по периодам',
      { href: '/dashboard/manager/dynamics?from=cockpit&role=cto', label: 'Динамика качества' },
    );
  },
};

// ── 6.3 «Насколько мы надёжны?» ──
const ReliabilityTile: CockpitTile = {
  id: 'cto-reliability',
  question: 'Насколько мы надёжны?',
  perm: 'view.dashboard.incidents',
  defaultEnabled: true,
  useValue(): TileValue {
    // system_name (не id) — slice.systems хранит id; фильтр по конкретной ИС здесь не
    // применяется (портфельная надёжность), см. §17 границ ТЗ v21.
    const { data, loading } = useCockpitFetch<IncidentAnalytics>('/incidents/analytics');
    if (loading) return { value: null, tone: 'neutral', subtitle: '', loading: true };
    if (!data || data.availabilityPct === null) {
      return { value: null, tone: 'neutral', subtitle: '', empty: { reason: data?.total ? 'Доступность не считается: не заполнена длительность простоя у сбоев' : 'Нет зарегистрированных технических сбоёв' } };
    }
    const tone: Tone = data.availabilityPct >= 99.5 ? 'high' : data.availabilityPct >= 98 ? 'medium' : 'critical';
    return {
      value: data.availabilityPct, unit: '%', tone,
      subtitle: `MTTR ${data.avgMttrHours ?? '—'} ч · MTBF ${data.mtbfHours ? Math.round(data.mtbfHours) : '—'} ч · ${data.total} сбоев`,
    };
  },
  Detail() {
    const { data } = useCockpitFetch<IncidentAnalytics>('/incidents/analytics');
    return detailTable(
      data?.byCategory ?? [],
      [
        { title: 'Первопричина', dataIndex: 'category' },
        { title: 'Число сбоев', dataIndex: 'count' },
        { title: 'Открыто', dataIndex: 'openCount' },
        { title: 'MTTR, ч', dataIndex: 'avgMttrHours' },
      ],
      'Нет данных',
      { href: '/dashboard/incidents?from=cockpit&role=cto', label: 'Аналитика сбоев' },
    );
  },
};

// ── 6.4 «Что может рвануть?» ──
const RiskRadarTile: CockpitTile = {
  id: 'cto-radar',
  question: 'Что может рвануть?',
  perm: 'view.dashboard.risk_radar',
  defaultEnabled: true,
  useValue(slice): TileValue {
    const sysName = useSingleSystemName(slice);
    const { data, loading } = useCockpitFetch<TriggeredRisk[]>(`/risks/triggered${qs({ system: sysName })}`);
    if (loading) return { value: null, tone: 'neutral', subtitle: '', loading: true };
    if (!data) return { value: null, tone: 'neutral', subtitle: '', empty: { reason: 'Не удалось получить сработавшие триггеры' } };
    if (!data.length) return { value: 0, tone: 'high', subtitle: 'Сработавших триггеров нет' };
    return {
      value: data.length, unit: 'шт.', tone: data.length > 3 ? 'critical' : 'medium',
      subtitle: 'Метрики подошли к опасной границе, отказа ещё не было',
    };
  },
  Detail({ slice }) {
    const sysName = useSingleSystemName(slice);
    const { data } = useCockpitFetch<TriggeredRisk[]>(`/risks/triggered${qs({ system: sysName })}`);
    return detailTable(
      data ?? [],
      [
        { title: 'Риск', dataIndex: 'title', ellipsis: true },
        { title: 'Характеристика', dataIndex: 'characteristic' },
        { title: 'Условие срабатывания', dataIndex: 'triggeredBy' },
        { title: 'Владелец', dataIndex: 'owner' },
      ],
      'Сработавших триггеров нет',
      { href: '/dashboard/risk-radar?from=cockpit&role=cto', label: 'Риск-радар' },
    );
  },
};

// ── 6.5 «Кто и что делает?» ──
const ManagerLoadTile: CockpitTile = {
  id: 'cto-managers',
  question: 'Кто и что делает?',
  perm: 'view.risk_economics',
  defaultEnabled: true,
  useValue(): TileValue {
    const { data, loading } = useCockpitFetch<ManagerMetrics>('/econ/manager-metrics');
    if (loading) return { value: null, tone: 'neutral', subtitle: '', loading: true };
    if (!data || !data.rows.length) return { value: null, tone: 'neutral', subtitle: '', empty: { reason: 'Нет данных по нагрузке ответственных' } };
    const overdueOwners = data.rows.filter((r) => r.overdueCount > 0);
    const tone: Tone = overdueOwners.length ? 'critical' : 'high';
    return {
      value: overdueOwners.reduce((a, r) => a + r.overdueCount, 0), unit: 'шт.', tone,
      subtitle: overdueOwners.length ? `просрочки у ${overdueOwners.length} ответственных` : 'Просрочек нет',
    };
  },
  Detail() {
    const { data } = useCockpitFetch<ManagerMetrics>('/econ/manager-metrics');
    return detailTable(
      data?.rows ?? [],
      [
        { title: 'Ответственный', dataIndex: 'owner' },
        { title: 'Открыто', dataIndex: 'openCount' },
        { title: 'Просрочено', dataIndex: 'overdueCount' },
        { title: 'Выполнено', dataIndex: 'completedCount' },
        { title: 'ΔALE под управлением, ₽', dataIndex: 'deltaAleManaged', render: (v: number) => fmtMoneyCompact(v) },
      ],
      'Нет данных',
      { href: '/dashboard/taskplan?from=cockpit&role=cto', label: 'План задач' },
    );
  },
};

export const CTO_TILES: CockpitTile[] = [
  DecisionQueueTile, DegradedTile, ReliabilityTile, RiskRadarTile, ManagerLoadTile,
];
