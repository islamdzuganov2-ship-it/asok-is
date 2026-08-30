/**
 * ctoTiles.tsx — реестр плиток кокпита CTO (ТЗ v21 §6). Линза по умолчанию — 'score'.
 *
 * Очередь решений (6.1) читает Redux (`selectVisibleProposals`), а не бандл — те же меры, что
 * уже синхронизирует `syncProposals` (AppLayout), и то же решение — через уже существующий
 * `MeasureDecisionModal` (SoD проверяется на сервере, как сейчас). Остальные четыре плитки
 * читают ОДИН бандл (`useGetCockpitBundleQuery` — §10.5): RTK Query дедуплицирует одинаковые
 * аргументы сам, поэтому разные плитки с одним разрезом дают один сетевой запрос.
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
import { useGetCockpitBundleQuery, useGetSystemsQuery } from '../../store/api/apiSlice';
import { cockpitBundleArgs } from './bundleArgs';
import { useSingleSystemName } from './useSliceSystemName';
import { fmtMoneyCompact } from '../../utils/money';

const { Text } = Typography;

function useCtoBundle(slice: Slice) {
  return useGetCockpitBundleQuery(cockpitBundleArgs('CTO', slice));
}

/** `/dashboard/taskplan` уже читает `?characteristic=`/`?owner=` (ТЗ v20 п.1) — донашиваем
 * текущий разрез, а не открываем план задач «с чистого листа» (ТЗ v21 §3.5). */
function taskplanHref(slice: Slice): string {
  const p = new URLSearchParams({ from: 'cockpit', role: 'cto' });
  if (slice.characteristic) p.set('characteristic', slice.characteristic);
  if (slice.owner) p.set('owner', slice.owner);
  return `/dashboard/taskplan?${p.toString()}`;
}
function loadErrorValue(isLoading: boolean, isError: boolean): TileValue | null {
  if (isLoading) return { value: null, tone: 'neutral', subtitle: '', loading: true };
  if (isError) return { value: null, tone: 'neutral', subtitle: '', empty: { reason: 'Не удалось получить данные кокпита' } };
  return null;
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
  formula: { summary: 'Число решений в очереди одобрения, ожидающих CTO' },
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
          { href: taskplanHref(slice), label: 'План задач' },
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
  formula: {
    summary: 'Дельта портфельного балла качества к прошлому периоду',
    credit: ['рост балла за период'],
    debit: ['падение балла за период'],
  },
  useValue(slice): TileValue {
    const { data, isLoading, isError } = useCtoBundle(slice);
    const early = loadErrorValue(isLoading, isError);
    if (early) return early;
    const t = data!.portfolioTrendScore!;
    if (t.emptyReason || t.points.length < 2) {
      return { value: null, tone: 'neutral', subtitle: '', empty: { reason: t.emptyReason ?? 'Недостаточно периодов для сравнения' } };
    }
    const delta = t.deltaAbsolute ?? 0;
    const tone: Tone = t.anomaly ? 'critical' : delta < 0 ? 'medium' : 'high';
    return {
      value: `${delta > 0 ? '+' : ''}${delta}`, unit: 'п.п.', tone,
      trend: t.points.map((p) => p.value),
      delta: { value: delta, unit: ' п.п.', direction: delta >= 0 ? 'up' : 'down' },
      subtitle: t.anomaly ? 'Аномальное изменение (≥12 п.п.) — требует зафиксированной причины' : 'В пределах обычных колебаний',
    };
  },
  Detail({ slice }) {
    const { data } = useCtoBundle(slice);
    return detailTable(
      data?.portfolioTrendScore?.points ?? [],
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
  formula: {
    summary: 'Доступность = 100% минус доля простоя за окно наблюдения',
    credit: ['время в строю'],
    debit: ['суммарный простой из-за сбоев'],
  },
  useValue(slice): TileValue {
    const { data, isLoading, isError } = useCtoBundle(slice);
    const early = loadErrorValue(isLoading, isError);
    if (early) return early;
    const d = data!.incidentAnalytics!;
    if (d.availabilityPct === null) {
      return { value: null, tone: 'neutral', subtitle: '', empty: { reason: d.total ? 'Доступность не считается: не заполнена длительность простоя у сбоев' : 'Нет зарегистрированных технических сбоёв' } };
    }
    const tone: Tone = d.availabilityPct >= 99.5 ? 'high' : d.availabilityPct >= 98 ? 'medium' : 'critical';
    return {
      value: d.availabilityPct, unit: '%', tone,
      subtitle: `MTTR ${d.avgMttrHours ?? '—'} ч · MTBF ${d.mtbfHours ? Math.round(d.mtbfHours) : '—'} ч · ${d.total} сбоев`,
    };
  },
  Detail({ slice }) {
    const { data } = useCtoBundle(slice);
    const sysName = useSingleSystemName(slice);
    const href = `/dashboard/incidents?from=cockpit&role=cto${sysName ? `&system=${encodeURIComponent(sysName)}` : ''}`;
    return detailTable(
      data?.incidentAnalytics?.byCategory ?? [],
      [
        { title: 'Первопричина', dataIndex: 'category' },
        { title: 'Число сбоев', dataIndex: 'count' },
        { title: 'Открыто', dataIndex: 'openCount' },
        { title: 'MTTR, ч', dataIndex: 'avgMttrHours' },
      ],
      'Нет данных',
      { href, label: 'Аналитика сбоев' },
    );
  },
};

// ── 6.4 «Что может рвануть?» ──
const RiskRadarTile: CockpitTile = {
  id: 'cto-radar',
  question: 'Что может рвануть?',
  perm: 'view.dashboard.risk_radar',
  defaultEnabled: true,
  formula: { summary: 'Число рисков с признаками скорой реализации (сработавшие триггеры)' },
  useValue(slice): TileValue {
    const { data, isLoading, isError } = useCtoBundle(slice);
    const early = loadErrorValue(isLoading, isError);
    if (early) return early;
    const list = data!.triggeredRisks ?? [];
    if (!list.length) return { value: 0, tone: 'high', subtitle: 'Сработавших триггеров нет' };
    return {
      value: list.length, unit: 'шт.', tone: list.length > 3 ? 'critical' : 'medium',
      subtitle: 'Метрики подошли к опасной границе, отказа ещё не было',
    };
  },
  Detail({ slice }) {
    const { data } = useCtoBundle(slice);
    const sysName = useSingleSystemName(slice);
    const href = `/dashboard/risk-radar?from=cockpit&role=cto${sysName ? `&system=${encodeURIComponent(sysName)}` : ''}`;
    return detailTable(
      data?.triggeredRisks ?? [],
      [
        { title: 'Риск', dataIndex: 'title', ellipsis: true },
        { title: 'Характеристика', dataIndex: 'characteristic' },
        { title: 'Условие срабатывания', dataIndex: 'triggeredBy' },
        { title: 'Владелец', dataIndex: 'owner' },
      ],
      'Сработавших триггеров нет',
      { href, label: 'Риск-радар' },
    );
  },
};

// ── 6.5 «Кто и что делает?» ──
const ManagerLoadTile: CockpitTile = {
  id: 'cto-managers',
  question: 'Кто и что делает?',
  perm: 'view.risk_economics',
  defaultEnabled: true,
  formula: { summary: 'Сумма просроченных мер по ответственным' },
  useValue(slice): TileValue {
    const { data, isLoading, isError } = useCtoBundle(slice);
    const early = loadErrorValue(isLoading, isError);
    if (early) return early;
    const rows = data!.managerMetrics?.rows ?? [];
    if (!rows.length) return { value: null, tone: 'neutral', subtitle: '', empty: { reason: 'Нет данных по нагрузке ответственных' } };
    const overdueOwners = rows.filter((r) => r.overdueCount > 0);
    const tone: Tone = overdueOwners.length ? 'critical' : 'high';
    return {
      value: overdueOwners.reduce((a, r) => a + r.overdueCount, 0), unit: 'шт.', tone,
      subtitle: overdueOwners.length ? `просрочки у ${overdueOwners.length} ответственных` : 'Просрочек нет',
    };
  },
  Detail({ slice }) {
    const { data } = useCtoBundle(slice);
    return detailTable(
      data?.managerMetrics?.rows ?? [],
      [
        { title: 'Ответственный', dataIndex: 'owner' },
        { title: 'Открыто', dataIndex: 'openCount' },
        { title: 'Просрочено', dataIndex: 'overdueCount' },
        { title: 'Выполнено', dataIndex: 'completedCount' },
        { title: 'ΔALE под управлением, ₽', dataIndex: 'deltaAleManaged', render: (v: number) => fmtMoneyCompact(v) },
        { title: 'Ср. возраст открытых, дн.', dataIndex: 'avgAgeDays', render: (v: number | null) => v ?? '—' },
        { title: 'Доля «принять», %', dataIndex: 'acceptShare' },
        { title: 'Доля компенсирующих, %', dataIndex: 'compensatingShare' },
        { title: 'Взвешенная нагрузка', dataIndex: 'weightedLoad' },
        { title: 'Часов оценено', dataIndex: 'hoursEstimated' },
      ],
      'Нет данных',
      { href: taskplanHref(slice), label: 'План задач' },
    );
  },
};

// ── 6.6 «Насколько мы понимаем объём работы впереди?» ──
const PlanningCoverageTile: CockpitTile = {
  id: 'cto-planning-coverage',
  question: 'Насколько мы понимаем объём работы впереди?',
  perm: 'view.risk_economics',
  defaultEnabled: true,
  formula: {
    summary: 'Доля открытых мер с оценкой трудозатрат — насколько известен объём работы',
    credit: ['меры с оценкой трудозатрат'],
    debit: ['меры без оценки (объём неизвестен)'],
  },
  useValue(slice): TileValue {
    const { data, isLoading, isError } = useCtoBundle(slice);
    const early = loadErrorValue(isLoading, isError);
    if (early) return early;
    const rows = data!.managerMetrics?.rows ?? [];
    const withEstimate = rows.reduce((a, r) => a + r.measuresWithEstimate, 0);
    const withoutEstimate = rows.reduce((a, r) => a + r.measuresWithoutEstimate, 0);
    const total = withEstimate + withoutEstimate;
    if (!total) {
      return { value: null, tone: 'neutral', subtitle: '', empty: { reason: 'Нет открытых мер, чтобы оценить объём работы' } };
    }
    const share = Math.round((withEstimate / total) * 100);
    const tone: Tone = share >= 80 ? 'high' : share >= 50 ? 'medium' : 'critical';
    return {
      value: share, unit: '%', tone,
      subtitle: `${withEstimate} из ${total} открытых мер с оценкой часов`,
    };
  },
  Detail({ slice }) {
    const { data } = useCtoBundle(slice);
    return detailTable(
      data?.managerMetrics?.rows ?? [],
      [
        { title: 'Ответственный', dataIndex: 'owner' },
        { title: 'С оценкой', dataIndex: 'measuresWithEstimate' },
        { title: 'Без оценки', dataIndex: 'measuresWithoutEstimate' },
        { title: 'Часов оценено', dataIndex: 'hoursEstimated' },
      ],
      'Нет данных',
      { href: taskplanHref(slice), label: 'План задач' },
    );
  },
};

// ── 6.7 «Что чаще всего у нас ломается?» ──
const IncidentsMixTile: CockpitTile = {
  id: 'cto-incidents-mix',
  question: 'Что чаще всего у нас ломается?',
  perm: 'view.dashboard.incidents',
  defaultEnabled: true,
  formula: { summary: 'Доля сбоев по причине с наибольшим числом инцидентов за период' },
  useValue(slice): TileValue {
    const { data, isLoading, isError } = useCtoBundle(slice);
    const early = loadErrorValue(isLoading, isError);
    if (early) return early;
    const d = data!.incidentAnalytics!;
    const byCategory = [...(d.byCategory ?? [])].sort((a, b) => b.count - a.count);
    if (!d.total || !byCategory.length) {
      return { value: 0, tone: 'high', subtitle: 'Технических сбоёв не зарегистрировано' };
    }
    const top = byCategory[0];
    const share = Math.round((top.count / d.total) * 100);
    return {
      value: share, unit: '%', tone: share > 50 ? 'critical' : 'medium',
      subtitle: `${top.category} · ${top.count} из ${d.total} сбоёв`,
    };
  },
  Detail({ slice }) {
    const { data } = useCtoBundle(slice);
    const sysName = useSingleSystemName(slice);
    const href = `/dashboard/incidents?from=cockpit&role=cto${sysName ? `&system=${encodeURIComponent(sysName)}` : ''}`;
    return detailTable(
      data?.incidentAnalytics?.byCategory ?? [],
      [
        { title: 'Первопричина', dataIndex: 'category' },
        { title: 'Число сбоев', dataIndex: 'count' },
        { title: 'Открыто', dataIndex: 'openCount' },
        { title: 'MTTR, ч', dataIndex: 'avgMttrHours' },
      ],
      'Нет данных',
      { href, label: 'Аналитика сбоев' },
    );
  },
};

export const CTO_TILES: CockpitTile[] = [
  DecisionQueueTile, DegradedTile, ReliabilityTile, RiskRadarTile, ManagerLoadTile,
  PlanningCoverageTile, IncidentsMixTile,
];
