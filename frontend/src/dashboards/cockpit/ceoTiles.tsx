/**
 * ceoTiles.tsx — реестр плиток кокпита CEO (ТЗ v21 §5). Линза по умолчанию — 'ale'.
 *
 * Денежный слой — на живых данных modules/econ (заказчик подтвердил 25.08.2026). Портфельная
 * дельта (Δ к прошлому периоду) реализована только там, где история по периодам реально
 * существует (см. portfolio_trend_service.py); для ALE/замкнутости контура снимков по периодам
 * нет — плитки честно показывают текущее значение без Δ, а не выдуманную дельту (§7.3, §10.2).
 */
import React from 'react';
import { Table, Tag, Typography, Space } from 'antd';
import { Link } from 'react-router-dom';
import { RightOutlined } from '@ant-design/icons';
import type { CockpitTile, TileValue, Tone } from './types';
import type { Slice } from '../../store/slice/sliceTypes';
import { CRITICALITY_TO_CLASS } from '../../store/slice/sliceTypes';
import { useCockpitFetch } from './useCockpitData';
import { qs } from '../../utils/apiFetch';
import { fmtMoney, fmtMoneyCompact } from '../../utils/money';

const { Text } = Typography;

interface CostDashboard {
  portfolioAle: number; risksCount: number; nonconformitiesTotal: number; verified: number;
  closureRate: number; blockingCount: number;
  verdict: { eliminate: number; compensate: number; accept: number };
  bySystem: { system: string; ale: number }[];
}
interface AcceptanceItem {
  id: string; title: string; systemName: string | null; criticality: string | null; ale: number;
  signer: string | null; waitingDays: number; slaDays: number; overdue: boolean; vetoes: string[];
}
interface AcceptanceQueue {
  items: AcceptanceItem[];
  bySigner: { signer: string; count: number; totalAle: number; overdue: number }[];
  matrixApplied: { maxAle: number | null; signer: string }[];
}
interface PortfolioRiskSummary {
  totalAtRisk: number; coveredByDoneMeasures: number; residualRisk: number;
  requiredInvestment: number; expectedEffect: number; risksCount: number; measuresCount: number;
}
interface EffectCurve {
  points: { quarterLabel: string; netCash: number; cumulative: number }[];
  measuresIncluded: number; measuresExcludedNoStartDate: number;
}
interface OverdueItem {
  proposalId: string; title: string; systemName: string | null; owner: string | null;
  overdueDays: number; priceCurrent: number | null; escalated: boolean;
}
interface OverdueSummary {
  overdueCount: number; ownersAffected: number; totalPriceCurrent: number; totalPriceSnapshot: number;
  byOwner: { owner: string; count: number; price: number }[]; items: OverdueItem[];
}

function sysParam(slice: Slice): string | undefined {
  return slice.systems.length === 1 ? slice.systems[0] : undefined;
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
        ? <Table size="small" dataSource={rows} columns={columns} rowKey={(r: any) => r.id ?? r.proposalId ?? r.system ?? r.signer} pagination={{ pageSize: 7 }} scroll={{ x: 'max-content' }} />
        : <Text type="secondary">{empty}</Text>}
      {l3 && l3Link(l3.href, l3.label)}
    </Space>
  );
}

// ── 5.1 «Сколько нам стоит текущее качество?» ──
const CostTile: CockpitTile = {
  id: 'ceo-cost',
  question: 'Сколько нам стоит текущее качество?',
  perm: 'view.risk_economics',
  defaultEnabled: true,
  useValue(slice): TileValue {
    const { data, loading, error } = useCockpitFetch<CostDashboard>(
      `/econ/dashboard${qs({ system_id: sysParam(slice) })}`,
    );
    if (loading) return { value: null, tone: 'neutral', subtitle: '', loading: true };
    if (error || !data) {
      return { value: null, tone: 'neutral', subtitle: '', empty: { reason: 'Не удалось получить данные econ/dashboard' } };
    }
    if (!data.risksCount) {
      return {
        value: null, tone: 'neutral', subtitle: '',
        empty: { reason: 'Стоимость не рассчитана: нет активных рисковых событий с посчитанным ALE',
                fixHref: '/risk-economics?from=cockpit&role=ceo', fixLabel: 'Открыть риск-экономику →' },
      };
    }
    const tone: Tone = data.portfolioAle > 10_000_000 ? 'critical' : data.portfolioAle > 2_000_000 ? 'medium' : 'high';
    return {
      value: fmtMoneyCompact(data.portfolioAle), tone,
      subtitle: `${data.risksCount} активных рисковых события в портфеле`,
    };
  },
  Detail({ slice }) {
    const { data } = useCockpitFetch<CostDashboard>(`/econ/dashboard${qs({ system_id: sysParam(slice) })}`);
    return detailTable(
      data?.bySystem ?? [],
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
    const { data, loading, error } = useCockpitFetch<AcceptanceQueue>(
      `/econ/acceptance-queue${qs({ system_id: sysParam(slice), criticality: critParam(slice) })}`,
    );
    if (loading) return { value: null, tone: 'neutral', subtitle: '', loading: true };
    if (error || !data) return { value: null, tone: 'neutral', subtitle: '', empty: { reason: 'Не удалось получить очередь по матрице акцепта' } };
    const topSigner = data.matrixApplied.find((m) => m.maxAle === null)?.signer;
    const boardItems = topSigner ? data.items.filter((i) => i.signer === topSigner) : [];
    const overdue = boardItems.filter((i) => i.overdue).length;
    if (!data.items.length) {
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
    const { data } = useCockpitFetch<AcceptanceQueue>(
      `/econ/acceptance-queue${qs({ system_id: sysParam(slice), criticality: critParam(slice) })}`,
    );
    return detailTable(
      data?.items ?? [],
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
    const summaryPath = `/risk-events/portfolio-summary${qs({ system_id: sysParam(slice) })}`;
    const curvePath = `/governance/proposals/effect-curve${qs({ system_id: sysParam(slice) })}`;
    const s = useCockpitFetch<PortfolioRiskSummary>(summaryPath);
    const c = useCockpitFetch<EffectCurve>(curvePath);
    if (s.loading || c.loading) return { value: null, tone: 'neutral', subtitle: '', loading: true };
    if (!s.data || !s.data.requiredInvestment) {
      return {
        value: null, tone: 'neutral', subtitle: '',
        empty: { reason: 'ROSI не считается: нет одобренных мер с вложениями', fixHref: '/dashboard/taskplan?from=cockpit&role=ceo', fixLabel: 'Открыть план задач →' },
      };
    }
    const rosi = (s.data.expectedEffect - s.data.requiredInvestment) / s.data.requiredInvestment;
    const excluded = c.data?.measuresExcludedNoStartDate ?? 0;
    return {
      value: `${rosi >= 0 ? '+' : ''}${Math.round(rosi * 100)}`,
      unit: '%',
      tone: rosi >= 0 ? 'high' : 'critical',
      trend: c.data?.points.map((p) => p.cumulative),
      subtitle: excluded
        ? `${c.data?.measuresIncluded ?? 0} мер в расчёте · ${excluded} без даты старта не учтены`
        : `${c.data?.measuresIncluded ?? 0} мер в расчёте`,
    };
  },
  Detail({ slice }) {
    const { data } = useCockpitFetch<EffectCurve>(`/governance/proposals/effect-curve${qs({ system_id: sysParam(slice) })}`);
    return detailTable(
      data?.points ?? [],
      [
        { title: 'Квартал', dataIndex: 'quarterLabel' },
        { title: 'Чистый эффект, ₽', dataIndex: 'netCash', render: (v: number) => fmtMoney(v) },
        { title: 'Накопительно, ₽', dataIndex: 'cumulative', render: (v: number) => fmtMoney(v) },
      ],
      'Нет мер с определённой датой старта',
      { href: '/dashboard/taskplan?from=cockpit&role=ceo', label: 'План задач' },
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
    const { data, loading } = useCockpitFetch<PortfolioRiskSummary>(`/risk-events/portfolio-summary${qs({ system_id: sysParam(slice) })}`);
    if (loading) return { value: null, tone: 'neutral', subtitle: '', loading: true };
    if (!data || !data.risksCount) {
      return { value: null, tone: 'neutral', subtitle: '', empty: { reason: 'Нет активных рисковых событий в портфеле' } };
    }
    const tone: Tone = data.residualRisk > data.totalAtRisk * 0.7 ? 'critical' : data.residualRisk > data.totalAtRisk * 0.3 ? 'medium' : 'high';
    return {
      value: fmtMoneyCompact(data.residualRisk), tone,
      subtitle: `покрыто выполненными мерами ${fmtMoneyCompact(data.coveredByDoneMeasures)} из ${fmtMoneyCompact(data.totalAtRisk)}`,
    };
  },
  Detail({ slice }) {
    const { data } = useCockpitFetch<CostDashboard>(`/econ/dashboard${qs({ system_id: sysParam(slice) })}`);
    return detailTable(
      (data?.bySystem ?? []).slice(0, 5),
      [
        { title: 'ИС', dataIndex: 'system' },
        { title: 'ALE, ₽/год', dataIndex: 'ale', render: (v: number) => fmtMoney(v) },
      ],
      'Нет данных',
      { href: '/dashboard/risk-radar?from=cockpit&role=ceo', label: 'Риск-радар' },
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
    const dash = useCockpitFetch<CostDashboard>(`/econ/dashboard${qs({ system_id: sysParam(slice) })}`);
    const ov = useCockpitFetch<OverdueSummary>(`/governance/proposals/overdue-summary${qs({ system_id: sysParam(slice) })}`);
    if (dash.loading || ov.loading) return { value: null, tone: 'neutral', subtitle: '', loading: true };
    if (!dash.data || !dash.data.nonconformitiesTotal) {
      return { value: null, tone: 'neutral', subtitle: '', empty: { reason: 'Нет зафиксированных несоответствий — замыкать пока нечего' } };
    }
    const rate = dash.data.closureRate;
    const tone: Tone = rate >= 75 ? 'high' : rate >= 50 ? 'medium' : 'critical';
    const overdueCount = ov.data?.overdueCount ?? 0;
    return {
      value: rate, unit: '%', tone,
      subtitle: overdueCount
        ? `просрочено мер: ${overdueCount} · цена неисполнения ${fmtMoneyCompact(ov.data!.totalPriceCurrent)}`
        : 'Просроченных мер нет',
    };
  },
  Detail({ slice }) {
    const { data } = useCockpitFetch<OverdueSummary>(`/governance/proposals/overdue-summary${qs({ system_id: sysParam(slice) })}`);
    return detailTable(
      data?.items ?? [],
      [
        { title: 'Мера', dataIndex: 'title', ellipsis: true, width: 240 },
        { title: 'Ответственный', dataIndex: 'owner' },
        { title: 'Дней просрочки', dataIndex: 'overdueDays' },
        { title: 'Ц_ОМ, ₽', dataIndex: 'priceCurrent', render: (v: number | null) => fmtMoney(v) },
      ],
      'Просроченных мер нет',
      { href: '/dashboard/taskplan?from=cockpit&role=ceo', label: 'План задач → просроченные' },
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
    const { data, loading } = useCockpitFetch<CostDashboard>(`/econ/dashboard${qs({ system_id: sysParam(slice) })}`);
    if (loading) return { value: null, tone: 'neutral', subtitle: '', loading: true };
    if (!data || !data.nonconformitiesTotal) {
      return { value: 0, tone: 'high', subtitle: 'Незакрытых блокирующих несоответствий нет' };
    }
    return {
      value: data.blockingCount, unit: 'шт.',
      tone: data.blockingCount > 0 ? 'critical' : 'high',
      subtitle: `принято рисков с подписью: ${data.verdict.accept}`,
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
