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
        ? <Table size="small" dataSource={rows} columns={columns} rowKey={(r: any) => r.id ?? r.proposalId ?? r.system ?? r.signer ?? r.key} pagination={{ pageSize: 7 }} scroll={{ x: 'max-content' }} />
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
  formula: { summary: 'Сумма ожидаемых годовых потерь (вероятность × ущерб) по всем активным рисковым событиям портфеля' },
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
    // «Издержки» по своей роли (деньги под риском) — тон не зависит от величины: небольшой
    // ALE не «хорошая новость», это по-прежнему риск, которым надо управлять.
    return {
      value: fmtMoneyCompact(d.portfolioAle), tone: 'critical',
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
  formula: { summary: 'Число решений по несоответствиям, чья сумма ALE требует подписи именно на этом уровне матрицы полномочий' },
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
    const bySigner = data?.acceptanceQueue?.bySigner ?? [];
    return (
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        {bySigner.length > 0 && detailTable(
          bySigner,
          [
            { title: 'Подписант', dataIndex: 'signer' },
            { title: 'Решений', dataIndex: 'count' },
            { title: 'ALE, ₽', dataIndex: 'totalAle', render: (v: number) => fmtMoney(v) },
            { title: 'Просрочено', dataIndex: 'overdue' },
          ],
          'Очередь пуста',
        )}
        {detailTable(
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
        )}
      </Space>
    );
  },
};

// ── 5.3 «Что мы получим за то, что тратим?» ──
const RosiTile: CockpitTile = {
  id: 'ceo-rosi',
  question: 'Что мы получим за то, что тратим?',
  perm: 'view.risk_economics',
  defaultEnabled: true,
  formula: {
    summary: '(Эффект от мер − Вложения в меры) / Вложения в меры',
    credit: ['ожидаемый эффект мер (снятый ALE)'],
    debit: ['вложения в реализацию (CAPEX + OPEX)'],
  },
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
      // Эта плитка — «экономия» по своей роли (эффект от вложений), а не severity-датчик:
      // тон фиксирован зелёным независимо от знака ROSI, честность несёт сама цифра
      // (отрицательный % без «+» и есть сигнал «тратим больше, чем получаем»).
      tone: 'high',
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
  formula: {
    summary: 'Остаток риска = весь риск портфеля минус то, что уже закрыто выполненными мерами',
    credit: ['риск, закрытый выполненными мерами'],
    debit: ['риск, что остаётся непокрытым'],
  },
  useValue(slice): TileValue {
    const { data, isLoading, isError } = useCeoBundle(slice);
    const early = loadErrorValue(isLoading, isError);
    if (early) return early;
    const s = data!.portfolioSummary!;
    if (!s.risksCount) {
      return { value: null, tone: 'neutral', subtitle: '', empty: { reason: 'Нет активных рисковых событий в портфеле' } };
    }
    // «Издержки» по роли (непокрытая экспозиция) — тон не зависит от доли покрытия.
    return {
      value: fmtMoneyCompact(s.residualRisk), tone: 'critical',
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
  formula: {
    summary: 'Доля несоответствий с закрывающей мерой в срок',
    credit: ['закрыто в срок'],
    debit: ['просрочено или не закрыто'],
  },
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
    const byOwner = data?.overdueSummary?.byOwner ?? [];
    return (
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        {byOwner.length > 0 && detailTable(
          byOwner,
          [
            { title: 'Ответственный', dataIndex: 'owner' },
            { title: 'Мер в просрочке', dataIndex: 'count' },
            { title: 'Ц_ОМ, ₽', dataIndex: 'price', render: (v: number) => fmtMoney(v) },
          ],
          'Просроченных мер нет',
        )}
        {detailTable(
          data?.overdueSummary?.items ?? [],
          [
            { title: 'Мера', dataIndex: 'title', ellipsis: true, width: 240 },
            { title: 'Ответственный', dataIndex: 'owner' },
            { title: 'Дней просрочки', dataIndex: 'overdueDays' },
            { title: 'Ц_ОМ, ₽', dataIndex: 'priceCurrent', render: (v: number | null) => fmtMoney(v) },
          ],
          'Просроченных мер нет',
          { href: taskplanHref(slice, { status: 'Просрочено' }), label: 'План задач → просроченные' },
        )}
      </Space>
    );
  },
};

// ── 5.6 «Что мы покажем регулятору?» ──
const RegulatorTile: CockpitTile = {
  id: 'ceo-regulator',
  question: 'Что мы покажем регулятору?',
  perm: 'view.risk_economics',
  defaultEnabled: true,
  formula: { summary: 'Число несоответствий с вердиктом «устранить», ещё не закрытых — потенциальный вопрос проверяющего' },
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
  Detail({ slice }) {
    const { data } = useCeoBundle(slice);
    const v = data?.costDashboard?.verdict;
    return (
      <Space direction="vertical">
        {v && detailTable(
          [
            { key: 'eliminate', label: 'Устранить', value: v.eliminate },
            { key: 'compensate', label: 'Компенсировать', value: v.compensate },
            { key: 'accept', label: 'Принять (с подписью)', value: v.accept },
          ],
          [
            { title: 'Вердикт', dataIndex: 'label' },
            { title: 'Несоответствий', dataIndex: 'value' },
          ],
          'Нет данных',
        )}
        <Text type="secondary">Перечень несоответствий и их норм (ГОСТ / 187-ФЗ / требования к ИИ-системам) — на вкладке «Замыкание контура».</Text>
        {l3Link('/risk-economics?from=cockpit&role=ceo', 'Риск-экономика → Замыкание контура')}
      </Space>
    );
  },
};

// ── 5.7 «Что мы теряем, если ничего не делать?» ──
const DegradationTile: CockpitTile = {
  id: 'ceo-degradation',
  question: 'Что мы теряем, если ничего не делать?',
  perm: 'view.risk_economics',
  defaultEnabled: true,
  formula: {
    summary: 'Накопленная потеря ценности систем при бездействии (деградация без вмешательства)',
    credit: ['выполненные меры, сдерживающие деградацию'],
    debit: ['естественное старение ИС без вмешательства'],
  },
  useValue(slice): TileValue {
    const { data, isLoading, isError } = useCeoBundle(slice);
    const early = loadErrorValue(isLoading, isError);
    if (early) return early;
    const d = data!.costDashboard!;
    if (!d.risksCount) {
      return { value: null, tone: 'neutral', subtitle: '', empty: { reason: 'Деградация не считается: нет активных рисковых событий' } };
    }
    // «Издержки» по роли (потеря ценности при бездействии) — тон не зависит от величины.
    return {
      value: fmtMoneyCompact(d.degradationTotal), tone: 'critical',
      subtitle: `${fmtMoneyCompact(d.degradationTotal)} в год без вмешательства, из ${fmtMoneyCompact(d.portfolioAle)} общего ALE`,
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
      { href: '/risk-economics?from=cockpit&role=ceo', label: 'Риск-экономика → Дашборд стоимости' },
    );
  },
};

// ── 5.8 «Какой риск нам грозит сильнее всего?» ──
const TopRiskTile: CockpitTile = {
  id: 'ceo-top-risk',
  question: 'Какой риск нам грозит сильнее всего?',
  perm: 'view.risk_economics',
  defaultEnabled: true,
  formula: { summary: 'Самое дорогое рисковое событие портфеля по среднегодовым потерям (ALE)' },
  useValue(slice): TileValue {
    const { data, isLoading, isError } = useCeoBundle(slice);
    const early = loadErrorValue(isLoading, isError);
    if (early) return early;
    const top = data!.costDashboard!.topRisks;
    if (!top.length) {
      return { value: null, tone: 'neutral', subtitle: '', empty: { reason: 'Нет рисковых событий с посчитанным ALE' } };
    }
    const r = top[0];
    // «Издержки» по роли (самый дорогой риск) — тон не зависит от величины.
    return {
      value: fmtMoneyCompact(r.aleAvg), tone: 'critical',
      subtitle: `${r.title}${r.system ? ` · ${r.system}` : ''}${r.regulatory ? ' · регуляторный' : ''}`,
    };
  },
  Detail({ slice }) {
    const { data } = useCeoBundle(slice);
    return detailTable(
      data?.costDashboard?.topRisks ?? [],
      [
        { title: 'Риск', dataIndex: 'title', ellipsis: true, width: 220 },
        { title: 'ИС', dataIndex: 'system' },
        { title: 'Владелец', dataIndex: 'owner' },
        { title: 'ALE, ₽/год', dataIndex: 'aleAvg', render: (v: number) => fmtMoney(v) },
        { title: '', dataIndex: 'regulatory', render: (v: boolean) => v && <Tag color="gold">регуляторный</Tag> },
      ],
      'Нет данных',
      { href: '/risk-economics?from=cockpit&role=ceo', label: 'Риск-экономика → Дашборд стоимости' },
    );
  },
};

export const CEO_TILES: CockpitTile[] = [
  CostTile, AcceptanceTile, RosiTile, VulnerabilityTile, ClosureTile, RegulatorTile,
  DegradationTile, TopRiskTile,
];
