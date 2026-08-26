/**
 * incidentsCards.tsx — карточки «Аналитики технических сбоев» как единицы каталога.
 *
 * Ряды KPI сделаны одной карточкой на ряд (а не плиткой на карточку): плитки одного ряда
 * читаются вместе — «всего / открыто / MTTR / из-за релизов» это один показатель в четырёх
 * числах, и раздавать их по сетке поштучно значит разрешить собрать заведомо бессмысленный
 * дашборд. Внутри карточки плитки всё так же ужимаются по ширине ячейки.
 */
import React, { useMemo } from 'react';
import { Alert, Empty, Select, Space, Spin, Table, Tag, Typography } from 'antd';
import { ApiOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { INCIDENT_CATEGORIES } from '../../data/mockIncidents';
import type { TechIncidentDto } from '../../store/api/apiSlice';
import { BRAND, RAG, ACCENT, solidTagStyle } from '../../theme/ragPalette';
import { accentColorOf, SPACE, TYPE } from '../../theme/premium';
import { useChartTokens } from '../../theme/useThemeTokens';
import { numericColumn, numericText, sorterFor } from '../../theme/table';
import KpiCard from '../../components/KpiCard';
import {
  useIncidentsScope, CATEGORY_LABEL, CATEGORY_COLOR, CATEGORY_TAG_COLOR,
  SEVERITY_LABEL, SEVERITY_COLOR, SEVERITY_RANK, fmtDate, mttrHours, fmtMin,
} from '../scopes/IncidentsScope';
import GridCard from '../GridCard';
import AutoChart from '../AutoChart';

const { Text } = Typography;

/** Ряд KPI-плиток, ужимающийся по ширине ячейки. */
const KpiRow: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: SPACE.base }}>
    {children}
  </div>
);

const Loading = () => <div style={{ textAlign: 'center', padding: 24 }}><Spin /></div>;

// ─────────────────── KPI: общие показатели ───────────────────

export const IncidentsKpiCard: React.FC = () => {
  const { analytics, loading } = useIncidentsScope();
  return (
    <GridCard title="Ключевые показатели сбоев" accent="terracotta">
      {loading ? <Loading /> : (
        <KpiRow>
          <KpiCard title="Всего сбоев" value={analytics?.total ?? 0} />
          <KpiCard
            title="Открыто (не восстановлены)"
            value={analytics?.openCount ?? 0}
            color={(analytics?.openCount ?? 0) > 0 ? RAG.bad.strong : undefined}
          />
          <KpiCard title="Средний MTTR, ч" value={(analytics?.avgMttrHours ?? 0).toFixed(1)} />
          <KpiCard title="Из-за релизов, %" value={`${(analytics?.releaseInducedShare ?? 0).toFixed(1)} %`} />
        </KpiRow>
      )}
    </GridCard>
  );
};

// ─────────────────── KPI: тайминги устранения (ДЕФ-31) ───────────────────

export const IncidentsTtrCard: React.FC = () => {
  const { analytics, loading } = useIncidentsScope();
  return (
    <GridCard title="Тайминги устранения" accent="slate" hint="«—» = не измеряли, это не ноль">
      {loading ? <Loading /> : (
        <KpiRow>
          <KpiCard title="Реакция, мин" value={fmtMin(analytics?.ttr?.avgReactionMin)} />
          <KpiCard title="Устранение, мин" value={fmtMin(analytics?.ttr?.avgResolutionMin)} />
          <KpiCard title="Целевое решение, мин" value={fmtMin(analytics?.ttr?.avgTargetMin)} />
          <KpiCard
            title="Первопричина позже сервиса, ч"
            value={fmtMin(analytics?.ttr?.avgRootCauseLagHours)}
            color={(analytics?.ttr?.avgRootCauseLagHours ?? 0) > 24 ? RAG.medium.strong : undefined}
          />
        </KpiRow>
      )}
    </GridCard>
  );
};

// ─────────────────── Распределение по первопричинам ───────────────────

export const IncidentsDonutCard: React.FC = () => {
  const { analytics, loading } = useIncidentsScope();
  const chart = useChartTokens();

  const donutOption = useMemo(() => ({
    tooltip: { trigger: 'item', confine: true, formatter: '{b}: {c} ({d}%)' },
    legend: { bottom: 0, icon: 'circle', textStyle: { color: chart.ink } },
    series: [{
      type: 'pie', radius: ['52%', '78%'], center: ['50%', '44%'], avoidLabelOverlap: true,
      itemStyle: { borderColor: BRAND.surface, borderWidth: 2 },
      label: { show: false }, labelLine: { show: false },
      data: (analytics?.byCategory ?? []).map((c) => ({
        name: CATEGORY_LABEL[c.category] ?? c.category, value: c.count,
        itemStyle: { color: CATEGORY_COLOR[c.category] ?? RAG.muted.color },
      })),
    }],
  }), [analytics, chart.ink]);

  return (
    <GridCard title="Распределение по первопричинам" accent="terracotta" dotColor={accentColorOf('terracotta')}>
      {loading ? <Loading /> : analytics && analytics.total > 0 ? (
        <div style={{ display: 'flex', height: '100%', minHeight: 220 }}>
          <AutoChart option={donutOption} minHeight={220} />
        </div>
      ) : (
        <Empty description="Сбоев не зафиксировано" style={{ padding: SPACE.page }} />
      )}
    </GridCard>
  );
};

// ─────────────────── Таблица первопричин + топ нестабильных ИС ───────────────────

export const IncidentsCategoryTableCard: React.FC = () => {
  const { analytics, loading } = useIncidentsScope();
  return (
    <GridCard
      title="Первопричины: частота, доля, среднее время восстановления"
      accent="slate"
      dotColor={accentColorOf('slate')}
    >
      {loading ? <Loading /> : (
        <>
          <Table
            size="small"
            pagination={false}
            rowKey="category"
            scroll={{ x: 520 }}
            locale={{ emptyText: 'За выбранный период сбоев не зарегистрировано' }}
            dataSource={analytics?.byCategory ?? []}
            columns={[
              { title: 'Первопричина', dataIndex: 'category', sorter: sorterFor((r: any) => CATEGORY_LABEL[r.category] ?? r.category), render: (c: string) => <Tag style={solidTagStyle(CATEGORY_TAG_COLOR[c])}>{CATEGORY_LABEL[c] ?? c}</Tag> },
              numericColumn({ title: 'Сбоев', dataIndex: 'count', width: 80, sorter: sorterFor((r: any) => r.count) }),
              numericColumn({ title: 'Доля', dataIndex: 'share', width: 90, sorter: sorterFor((r: any) => r.share), render: (v: number) => `${v}%` }),
              numericColumn({ title: 'Открыто', dataIndex: 'openCount', width: 90, sorter: sorterFor((r: any) => r.openCount) }),
              numericColumn({ title: 'MTTR, ч', dataIndex: 'avgMttrHours', width: 90, sorter: sorterFor((r: any) => r.avgMttrHours), render: (v: number | null) => (v === null ? '—' : v) }),
            ]}
          />
          <div style={{ marginTop: SPACE.base }}>
            <Text strong>Топ нестабильных ИС</Text>
            <Space wrap style={{ marginTop: SPACE.snug }}>
              {(analytics?.topSystems ?? []).map((s) => (
                <Tag key={s.systemName} style={{ padding: `${SPACE.tight}px ${SPACE.cozy}px`, ...TYPE.bodySm }}>
                  {s.systemName}: <b style={numericText}>{s.count}</b>
                  {s.openCount > 0 && <span style={{ color: RAG.bad.strong }}> · открыто {s.openCount}</span>}
                </Tag>
              ))}
            </Space>
          </div>
        </>
      )}
    </GridCard>
  );
};

// ─────────────────── Реестр сбоев ───────────────────

export const IncidentsRegistryCard: React.FC = () => {
  const { registryRows, categoryFilter, setCategoryFilter, openIncident, loading } = useIncidentsScope();

  const columns: ColumnsType<TechIncidentDto> = [
    { title: 'ИС', dataIndex: 'systemName', width: 160, fixed: 'left' as const,
      sorter: sorterFor((r: TechIncidentDto) => r.systemName) },
    {
      title: 'Первопричина', dataIndex: 'category', width: 180,
      sorter: sorterFor((r: TechIncidentDto) => CATEGORY_LABEL[r.category] ?? r.category),
      render: (c: string) => <Tag style={solidTagStyle(CATEGORY_TAG_COLOR[c])}>{CATEGORY_LABEL[c] ?? c}</Tag>,
    },
    {
      title: 'Критичность', dataIndex: 'severity', width: 120,
      sorter: sorterFor((r: TechIncidentDto) => SEVERITY_RANK[r.severity] ?? -1),
      render: (s: string) => <Tag color={SEVERITY_COLOR[s]}>{SEVERITY_LABEL[s] ?? s}</Tag>,
    },
    { title: 'Сбой', dataIndex: 'title', ellipsis: true, sorter: sorterFor((r: TechIncidentDto) => r.title) },
    { title: 'Возник', dataIndex: 'occurredAt', width: 150, render: fmtDate,
      sorter: sorterFor((r: TechIncidentDto) => r.occurredAt) },
    {
      title: 'Статус', key: 'status', width: 130,
      sorter: sorterFor((r: TechIncidentDto) => (r.resolvedAt ? 1 : 0)),
      render: (_: unknown, r) => (r.resolvedAt ? <Tag color="green">восстановлен</Tag> : <Tag color="red">открыт</Tag>),
    },
    {
      title: 'MTTR, ч', key: 'mttr', width: 90,
      sorter: sorterFor((r: TechIncidentDto) => mttrHours(r)),
      render: (_: unknown, r) => { const m = mttrHours(r); return m === null ? <Text type="secondary">—</Text> : <Text strong>{m}</Text>; },
    },
  ];

  return (
    <GridCard
      accent="ink"
      title={`Реестр технических сбоев (${registryRows.length})`}
      hint="клик по строке — карточка сбоя"
      extra={(
        <Space>
          <Text type="secondary" style={TYPE.caption}>Первопричина:</Text>
          <Select
            allowClear size="small" style={{ minWidth: 180 }} placeholder="Все первопричины"
            value={categoryFilter} onChange={setCategoryFilter}
            options={INCIDENT_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))}
          />
        </Space>
      )}
    >
      {loading ? <Loading /> : (
        <Table
          size="small"
          rowKey="id"
          columns={columns}
          dataSource={registryRows}
          pagination={{ pageSize: 10, hideOnSinglePage: true }}
          scroll={{ x: 1000 }}
          onRow={(r) => ({ onClick: () => openIncident(r), style: { cursor: 'pointer' } })}
        />
      )}
    </GridCard>
  );
};

// ─────────────────── Откуда берутся сбои ───────────────────

export const IncidentsSourceNoteCard: React.FC = () => {
  const { canManage } = useIncidentsScope();
  return (
    <GridCard title="Источник данных о сбоях" accent="none" dotColor={ACCENT.slate.color}>
      <Alert
        type="info"
        showIcon
        icon={<ApiOutlined />}
        message="Сбои поступают автоматически из ITSM и загрузкой из Excel/CSV"
        description={canManage
          ? 'Ручная регистрация сбоя по одному отключена. Технические сбои синхронизируются из ITSM и/или загружаются пакетом через «Загрузка ТС».'
          : 'Технические сбои синхронизируются из ITSM и загружаются пакетом из Excel/CSV. Реестр — только для просмотра и анализа.'}
      />
    </GridCard>
  );
};
