/**
 * ceoTiles.tsx — реестр плиток кокпита CEO (ТЗ v21 §5). Линза по умолчанию — 'ale'.
 *
 * Денежный слой — на живых данных modules/econ (заказчик подтвердил 25.08.2026). Все шесть
 * плиток читают ОДИН бандл (`useGetCockpitBundleQuery` — §10.5): RTK Query дедуплицирует
 * одинаковые аргументы сам, поэтому шесть плиток с одним разрезом дают один сетевой запрос,
 * а не шесть, и все дельты считаются от одной и той же точки отсчёта.
 *
 * Портфельная дельта (Δ к прошлому периоду) реализована только там, где история по периодам
 * реально существует (см. portfolio_trend_service.py); для ALE/замкнутости контура снимков по
 * периодам нет — плитки честно показывают текущее значение без Δ, а не выдуманную дельту
 * (§7.3, §10.2).
 */
import React from 'react';
import { Table, Tag, Typography, Space } from 'antd';
import { Link } from 'react-router-dom';
import { RightOutlined } from '@ant-design/icons';
import type { CockpitTile, TileValue, Tone } from './types';
import type { Slice } from '../../store/slice/sliceTypes';
import { useGetCockpitBundleQuery } from '../../store/api/apiSlice';
import { cockpitBundleArgs } from './bundleArgs';
import { useSingleSystemName } from './useSliceSystemName';
import { fmtMoney, fmtMoneyCompact } from '../../utils/money';

/** `/dashboard/taskplan` уже читает `?characteristic=`/`?owner=`/`?status=` (ТЗ v20 п.1) —
 * донашиваем текущий разрез, а не открываем план задач «с чистого листа» (ТЗ v21 §3.5). */
function taskplanHref(slice: Slice, extra?: { status?: string }): string {
  const p = new URLSearchParams({ from: 'cockpit', role: 'ceo' });
  if (slice.characteristic) p.set('characteristic', slice.characteristic);
  if (slice.owner) p.set('owner', slice.owner);
  if (extra?.status) p.set('status', extra.status);
  return `/dashboard/taskplan?${p.toString()}`;
}

const { Text } = Typography;

function useCeoBundle(slice: Slice) {
  return useGetCockpitBundleQuery(cockpitBundleArgs('CEO', slice));
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
        ? <Table size="small" dataSource={rows} columns={columns} rowKey={(r: any) => r.id ?? r.proposalId ?? r.system ?? r.signer} pagination={{ pageSize: 7 }} scroll={{ x: 'max-content' }} />
        : <Text type="secondary">{empty}</Text>}
      {l3 && l3Link(l3.href, l3.label)}
    </Space>
  );
}

function loadErrorValue(isLoading: boolean, isError: boolean): TileValue | null {
  if (isLoading) return { value: null, tone: 'neutral', subtitle: '', loading: true };
  if (isError) return { value: null, tone: 'neutral', subtitle: '', empty: { reason: 'Не удалось получить данные кокпита' } };
  return null;
}

// ── 5.1 «Сколько нам стоит текущее качество?» ──
const CostTile: CockpitTile = {
  id: 'ceo-cost',
  question: 'Сколько нам стоит текущее качество?',
  perm: 'view.risk_economics',
  defaultEnabled: true,
  useValue(slice): TileValue {
    const { data, isLoading, isError } = useCeoBundle(slice);
    const early = loadErrorValue(isLoading, isError);
    if (early) return early;
    const d = data!.costDashboard!;
    if (!d.risksCount) {
      return {
        value: null, tone: 'neutral', subtitle: '',
        empty: { reason: 'Стоимость не рассчитана: нет активных рисковых событий с посчитанным ALE',
                fixHref: '/risk-economics?from=cockpit&role=ceo', fixLabel: 'Открыть риск-экономику →' },
      };
    }
    const tone: Tone = d.portfolioAle > 10_000_000 ? 'critical' : d.portfolioAle > 2_000_000 ? 'medium' : 'high';
    return {
      value: fmtMoneyCompact(d.portfolioAle), tone,
      subtitle: `${d.risksCount} активных рисковых события в портфеле`,
    };
  },
  Detail({ slice }) {
    const { data } = useCeoBundle(slice);
    return detailTable(
      data?.costDashboard?.bySystem ?? [],
      [
        { title: 'ИС', dataIndex: 'system' },
        { title: 'ALE, ₽/год', dataIndex: 'ale', render: (v: number) => fmtMoney(v) },
      ],
      'Нет данных по ИС',
      { href: '/risk-economics?from=cockpit&role=ceo', label: 'Риск-экономика → Рисковые события' },
    );
  },
};

// ── 5.2 «Что требует моей подписи?» ──
const AcceptanceTile: CockpitTile = {
  id: 'ceo-acceptance',
  question: 'Что требует моей подписи?',
  perm: 'view.risk_economics',
  defaultEnabled: true,
  useValue(slice): TileValue {
    const { data, isLoading, isError } = useCeoBundle(slice);
    const early = loadErrorValue(isLoading, isError);
    if (early) return early;
    const q = data!.acceptanceQueue!;
    const topSigner = q.matrixApplied.find((m) => m.maxAle === null)?.signer;
    const boardItems = topSigner ? q.items.filter((i) => i.signer === topSigner) : [];
    const overdue = boardItems.filter((i) => i.overdue).length;
    if (!q.items.length) {
      return { value: 0, tone: 'high', subtitle: 'Решений, ожидающих оценки, нет' };
    }
    return {
      value: boardItems.length,
      unit: 'шт.',
      tone: overdue ? 'critical' : boardItems.length ? 'medium' : 'high',
      subtitle: overdue ? `${overdue} из них ждут дольше SLA` : `Уровень подписи: ${topSigner ?? '—'}`,
    };
  },
  Detail({ slice }) {
    const { data } = useCeoBundle(slice);
    return detailTable(
      data?.acceptanceQueue?.items ?? [],
      [
        { title: 'Предмет', dataIndex: 'title', ellipsis: true, width: 240 },
        { title: 'ИС', dataIndex: 'systemName' },
        { title: 'ALE, ₽', dataIndex: 'ale', render: (v: number) => fmtMoney(v) },
        { title: 'Подписант', dataIndex: 'signer' },
        { title: 'Дней в ожидании', dataIndex: 'waitingDays' },
        { title: '', dataIndex: 'overdue', render: (v: boolean) => v && <Tag color="red">просрочено</Tag> },
      ],
      'Очередь пуста',
      { href: '/risk-economics?from=cockpit&role=ceo', label: 'Риск-экономика → Замыкание контура' },
    );
  },
};

// ── 5.3 «Что мы получим за то, что тратим?» ──
const RosiTile: CockpitTile = {
  id: 'ceo-rosi',
  question: 'Что мы получим за то, что тратим?',
  perm: 'view.risk_economics',
  defaultEnabled: true,
  useValue(slice): TileValue {
    const { data, isLoading, isError } = useCeoBundle(slice);
    const early = loadErrorValue(isLoading, isError);
    if (early) return early;
    const s = data!.portfolioSummary!;
    const c = data!.effectCurve;
    if (!s.requiredInvestment) {
      return {
        value: null, tone: 'neutral', subtitle: '',
        empty: { reason: 'ROSI не считается: нет одобренных мер с вложениями', fixHref: taskplanHref(slice), fixLabel: 'Открыть план задач →' },
      };
    }
    const rosi = (s.expectedEffect - s.requiredInvestment) / s.requiredInvestment;
    const excluded = c?.measuresExcludedNoStartDate ?? 0;
    return {
      value: `${rosi >= 0 ? '+' : ''}${Math.round(rosi * 100)}`,
      unit: '%',
      tone: rosi >= 0 ? 'high' : 'critical',
      trend: c?.points.map((p) => p.cumulative),
      subtitle: excluded
        ? `${c?.measuresIncluded ?? 0} мер в расчёте · ${excluded} без даты старта не учтены`
        : `${c?.measuresIncluded ?? 0} мер в расчёте`,
    };
  },
  Detail({ slice }) {
    const { data } = useCeoBundle(slice);
    return detailTable(
      data?.effectCurve?.points ?? [],
      [
        { title: 'Квартал', dataIndex: 'quarterLabel' },
        { title: 'Чистый эффект, ₽', dataIndex: 'netCash', render: (v: number) => fmtMoney(v) },
        { title: 'Накопительно, ₽', dataIndex: 'cumulative', render: (v: number) => fmtMoney(v) },
      ],
      'Нет мер с определённой датой старта',
      { href: taskplanHref(slice), label: 'План задач' },
    );
  },
};

// ── 5.4 «Где мы уязвимы?» ──
const VulnerabilityTile: CockpitTile = {
  id: 'ceo-vulnerability',
  question: 'Где мы уязвимы?',
  perm: 'view.risk_economics',
  defaultEnabled: true,
  useValue(slice): TileValue {
    const { data, isLoading, isError } = useCeoBundle(slice);
    const early = loadErrorValue(isLoading, isError);
    if (early) return early;
    const s = data!.portfolioSummary!;
    if (!s.risksCount) {
      return { value: null, tone: 'neutral', subtitle: '', empty: { reason: 'Нет активных рисковых событий в портфеле' } };
    }
    const tone: Tone = s.residualRisk > s.totalAtRisk * 0.7 ? 'critical' : s.residualRisk > s.totalAtRisk * 0.3 ? 'medium' : 'high';
    return {
      value: fmtMoneyCompact(s.residualRisk), tone,
      subtitle: `покрыто выполненными мерами ${fmtMoneyCompact(s.coveredByDoneMeasures)} из ${fmtMoneyCompact(s.totalAtRisk)}`,
    };
  },
  Detail({ slice }) {
    const { data } = useCeoBundle(slice);
    const sysName = useSingleSystemName(slice);
    const radarHref = `/dashboard/risk-radar?from=cockpit&role=ceo${sysName ? `&system=${encodeURIComponent(sysName)}` : ''}`;
    return detailTable(
      (data?.costDashboard?.bySystem ?? []).slice(0, 5),
      [
        { title: 'ИС', dataIndex: 'system' },
        { title: 'ALE, ₽/год', dataIndex: 'ale', render: (v: number) => fmtMoney(v) },
      ],
      'Нет данных',
      { href: radarHref, label: 'Риск-радар' },
    );
  },
};

// ── 5.5 «Держим ли мы слово?» ──
const ClosureTile: CockpitTile = {
  id: 'ceo-closure',
  question: 'Держим ли мы слово?',
  perm: 'view.risk_economics',
  defaultEnabled: true,
  useValue(slice): TileValue {
    const { data, isLoading, isError } = useCeoBundle(slice);
    const early = loadErrorValue(isLoading, isError);
    if (early) return early;
    const dash = data!.costDashboard!;
    const ov = data!.overdueSummary!;
    if (!dash.nonconformitiesTotal) {
      return { value: null, tone: 'neutral', subtitle: '', empty: { reason: 'Нет зафиксированных несоответствий — замыкать пока нечего' } };
    }
    const rate = dash.closureRate;
    const tone: Tone = rate >= 75 ? 'high' : rate >= 50 ? 'medium' : 'critical';
    return {
      value: rate, unit: '%', tone,
      subtitle: ov.overdueCount
        ? `просрочено мер: ${ov.overdueCount} · цена неисполнения ${fmtMoneyCompact(ov.totalPriceCurrent)}`
        : 'Просроченных мер нет',
    };
  },
  Detail({ slice }) {
    const { data } = useCeoBundle(slice);
    return detailTable(
      data?.overdueSummary?.items ?? [],
      [
        { title: 'Мера', dataIndex: 'title', ellipsis: true, width: 240 },
        { title: 'Ответственный', dataIndex: 'owner' },
        { title: 'Дней просрочки', dataIndex: 'overdueDays' },
        { title: 'Ц_ОМ, ₽', dataIndex: 'priceCurrent', render: (v: number | null) => fmtMoney(v) },
      ],
      'Просроченных мер нет',
      { href: taskplanHref(slice, { status: 'Просрочено' }), label: 'План задач → просроченные' },
    );
  },
};

// ── 5.6 «Что мы покажем регулятору?» ──
const RegulatorTile: CockpitTile = {
  id: 'ceo-regulator',
  question: 'Что мы покажем регулятору?',
  perm: 'view.risk_economics',
  defaultEnabled: true,
  useValue(slice): TileValue {
    const { data, isLoading, isError } = useCeoBundle(slice);
    const early = loadErrorValue(isLoading, isError);
    if (early) return early;
    const d = data!.costDashboard!;
    if (!d.nonconformitiesTotal) {
      return { value: 0, tone: 'high', subtitle: 'Незакрытых блокирующих несоответствий нет' };
    }
    return {
      value: d.blockingCount, unit: 'шт.',
      tone: d.blockingCount > 0 ? 'critical' : 'high',
      subtitle: `принято рисков с подписью: ${d.verdict.accept}`,
    };
  },
  Detail() {
    return (
      <Space direction="vertical">
        <Text type="secondary">Перечень несоответствий и их норм (ГОСТ / 187-ФЗ / требования к ИИ-системам) — на вкладке «Замыкание контура».</Text>
        {l3Link('/risk-economics?from=cockpit&role=ceo', 'Риск-экономика → Замыкание контура')}
      </Space>
    );
  },
};

export const CEO_TILES: CockpitTile[] = [
  CostTile, AcceptanceTile, RosiTile, VulnerabilityTile, ClosureTile, RegulatorTile,
];
