/**
 * ceoTilesMore.tsx — плитки кокпита CEO 5.5–5.8 (ТЗ v21 §5): замкнутость, регулятор, деградация,
 * главный риск. Вынесено из ceoTiles.tsx (потолок размера модуля); реестр CEO_TILES — там же.
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
import { numericColumn } from '../../theme/table';

// ── 5.5 «Держим ли мы слово?» ──
export const ClosureTile: CockpitTile = {
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
            numericColumn({ title: 'Мер в просрочке', dataIndex: 'count' }),
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
export const RegulatorTile: CockpitTile = {
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
export const DegradationTile: CockpitTile = {
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
export const TopRiskTile: CockpitTile = {
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

// Порядок = порядок в сетке по умолчанию (registry.tsx строит раскладку из этого списка,
// 3 в ряд). ROSI — второй, а не третий: единственная плитка-«экономия» среди денежных,
// не должна прятаться в третьей колонке, которую на многих экранах не видно без прокрутки.
