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
import { Tag, Space } from 'antd';
import type { CockpitTile, TileValue, Tone } from './types';
import type { Slice } from '../../store/slice/sliceTypes';
import { useGetCockpitBundleQuery, useGetHeatmapMoneyLayerQuery, useGetSystemsQuery } from '../../store/api/apiSlice';
import { lensOf } from '../../store/slice/sliceTypes';
import { moneyBySystem, sortForLens } from './lensMath';
import { useSingleSystemName } from './useSliceSystemName';
import { fmtMoney, fmtMoneyCompact } from '../../utils/money';

import { Text, detailTable, l3Link, loadErrorValue, taskplanHref, useCeoBundle } from './ceoTileKit';
import { ClosureTile, RegulatorTile, DegradationTile, TopRiskTile } from './ceoTilesMore';
import { numericColumn } from '../../theme/table';

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
            numericColumn({ title: 'Решений', dataIndex: 'count' }),
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
    // Денежная линза (ТЗ-21 §3.1): ALE — из бандла (уже с учётом разреза); ΔALE и покрытие —
    // из денежного слоя теплокарты, свёрнутого по ИС. Балл качества у этой плитки не имеет
    // смысла (вопрос про деньги), поэтому в линзе «балл» показывается ALE.
    const lens = lensOf(slice, 'ale');
    const moneyLens = lens === 'delta' || lens === 'coverage';
    const { data: layer } = useGetHeatmapMoneyLayerQuery(undefined, { skip: !moneyLens });
    const { data: systemsResp } = useGetSystemsQuery(undefined, { skip: !moneyLens || !slice.systems.length });
    if (moneyLens) {
      const names = new Set((systemsResp?.items ?? []).filter((s) => slice.systems.includes(s.id)).map((s) => s.name));
      const cells = (layer ?? []).filter((c) => !slice.systems.length || names.has(c.systemName));
      const rows = sortForLens(moneyBySystem(cells), lens).slice(0, 5);
      const column = lens === 'delta'
        ? { title: 'ΔALE мерами, ₽/год', dataIndex: 'delta', render: (v: number) => fmtMoney(v) }
        : { title: 'Покрытие мерами, % ALE', dataIndex: 'coveragePct', render: (v: number | null) => (v === null ? 'нет ALE' : `${v}%`) };
      return detailTable(rows, [{ title: 'ИС', dataIndex: 'system' }, column], 'Нет данных', { href: radarHref, label: 'Риск-радар' });
    }
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

export const CEO_TILES: CockpitTile[] = [
  CostTile, RosiTile, AcceptanceTile, VulnerabilityTile, ClosureTile, RegulatorTile,
  DegradationTile, TopRiskTile,
];
