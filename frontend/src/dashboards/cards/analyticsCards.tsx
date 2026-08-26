/**
 * analyticsCards.tsx — карточки «Аналитического дашборда качества ИС».
 *
 * Донат распределения уровней раньше рисовался императивно (echarts.init на ref + подписка на
 * window.resize). В сетке размер меняет пользователь, а не окно, поэтому график переведён на
 * AutoChart с ResizeObserver — иначе после растягивания карточки бублик остаётся в старых
 * пикселях.
 */
import React, { useMemo } from 'react';
import { Select, Skeleton, Typography } from 'antd';
import { DatabaseOutlined } from '@ant-design/icons';
import LevelHeatmap, { LEVEL_COLORS } from '../../components/LevelHeatmap';
import KpiCard from '../../components/KpiCard';
import { critTagStyle, RAG, BRAND, ACCENT } from '../../theme/ragPalette';
import { accentColorOf, GOLD, SPACE, TYPE } from '../../theme/premium';
import { numericColumn, sorterFor } from '../../theme/table';
import { useAnalyticsScope, LEVEL_ORDER } from '../scopes/AnalyticsScope';
import GridCard from '../GridCard';
import AutoChart from '../AutoChart';
import { Table, Tag } from 'antd';

const { Text } = Typography;

const CRIT_RANK: Record<string, number> = { 'MISSION CRITICAL': 0, 'BUSINESS CRITICAL': 1, 'BUSINESS OPERATIONAL': 2 };
const critTag = (v: string) => <Tag style={critTagStyle(v)}>{v}</Tag>;

// ─────────────────── KPI ───────────────────

export const AnalyticsKpiCard: React.FC = () => {
  const {
    data, loading, isMock, healthPct, healthColor, lowTotal, measureLinksCount, openDetail,
  } = useAnalyticsScope();
  return (
    <GridCard
      title="Ключевые показатели ландшафта"
      accent="gold"
      dotColor={GOLD.base}
      extra={<Tag color={isMock ? 'gold' : 'green'}>{isMock ? 'Демо-данные' : 'Live из БД'}</Tag>}
      hint="клик по плитке — из чего складывается"
    >
      {/* Порядок (T-53): Глобальный балл · ИС · Метрики · Низкие · Метрик имеющих меры (T-54). */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: SPACE.base }}>
        <KpiCard title="Глобальный балл" value={`${healthPct}%`} color={healthColor} loading={loading} onClick={() => openDetail('global')} />
        <KpiCard title="ИС в мониторинге" value={data?.yAxisLabels.length ?? 0} loading={loading} onClick={() => openDetail('systems')} />
        <KpiCard title="Всего метрик" value={data?.totalMetrics ?? 0} loading={loading} onClick={() => openDetail('metrics')} />
        <KpiCard title="Низких метрик" value={lowTotal} color={RAG.bad.strong} loading={loading} onClick={() => openDetail('low')} />
        <KpiCard title="Метрик имеющих меры" value={measureLinksCount} color={RAG.good.strong} loading={loading} onClick={() => openDetail('measures')} />
      </div>
    </GridCard>
  );
};

// ─────────────────── Распределение по уровням ───────────────────

export const AnalyticsLevelsCard: React.FC = () => {
  const { data, loading, levelDist } = useAnalyticsScope();

  const option = useMemo(() => ({
    // confine: true — всплывашка держится внутри контейнера, иначе у левого края обрезается.
    tooltip: { trigger: 'item', confine: true, formatter: '{b}: {c} ({d}%)' },
    // Легенда — HTML-списком справа: встроенная перекрывала бублик.
    legend: { show: false },
    series: [{
      type: 'pie', radius: ['45%', '72%'], center: ['50%', '50%'],
      data: Object.entries(data?.levelCounts ?? {})
        .filter(([, v]) => v > 0)
        .map(([name, value]) => ({ name, value, itemStyle: { color: LEVEL_COLORS[name] ?? '#d9d9d9' } })),
      // Подписи на графике отключены полностью: контейнер узкий, ECharts режет их многоточием,
      // а то же самое уже написано во всплывашке и в легенде-списке.
      label: { show: false },
      labelLine: { show: false },
      emphasis: { scale: true, scaleSize: 4, label: { show: false } },
    }],
  }), [data?.levelCounts]);

  return (
    <GridCard title="Распределение по уровням качества" accent="slate" dotColor={ACCENT.slate.color}>
      {loading ? <Skeleton active paragraph={{ rows: 6 }} />
        : data?.totalMetrics === 0
          ? <Text type="secondary">Нет данных. Создайте период оценки и введите метрики.</Text>
          : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, height: '100%', minHeight: 200, flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 180px', minWidth: 160, display: 'flex', minHeight: 180 }}>
                <AutoChart option={option} minHeight={180} />
              </div>
              <div style={{ flex: '1 1 180px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {levelDist.map((r) => (
                  <span key={r.level} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: TYPE.caption.fontSize, color: BRAND.inkSoft }}>
                    <span style={{ width: 10, height: 10, borderRadius: 3, background: LEVEL_COLORS[r.level], flex: '0 0 auto' }} />
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.level}</span>
                    <b style={{ color: BRAND.ink }}>{r.count}</b>
                    <span style={{ color: BRAND.inkSoft, width: 38, textAlign: 'right' }}>{r.pct}%</span>
                  </span>
                ))}
              </div>
            </div>
          )}
    </GridCard>
  );
};

// ─────────────────── Проблемные ИС ───────────────────

export const AnalyticsProblemSystemsCard: React.FC = () => {
  const { loading, systemsWithSeverity, openSystemLowDetail } = useAnalyticsScope();
  return (
    <GridCard
      title="Проблемные ИС"
      accent="ink"
      dotColor={GOLD.base}
      hint="ранжирование по весу просевших характеристик"
    >
      {loading ? <Skeleton active /> : (
        <Table
          dataSource={systemsWithSeverity} rowKey="id" size="small" pagination={false}
          locale={{ emptyText: 'Нет проблемных систем' }}
          onRow={(r) => ({ onClick: () => openSystemLowDetail(r.name), style: { cursor: 'pointer' } })}
          columns={[
            { title: 'ИС', dataIndex: 'name', ellipsis: true, sorter: sorterFor((r: any) => r.name) },
            { title: 'Критичность', dataIndex: 'criticality',
              sorter: sorterFor((r: any) => CRIT_RANK[r.criticality] ?? -1), render: critTag },
            numericColumn({ title: 'Низких метрик', dataIndex: 'lowMetricsCount', width: 110,
              sorter: sorterFor((r: any) => r.lowMetricsCount), defaultSortOrder: 'descend',
              render: (v: number) => <Text type="danger" strong>{v}</Text> }),
          ]}
        />
      )}
    </GridCard>
  );
};

// ─────────────────── Тепловая карта ───────────────────

export const AnalyticsHeatmapCard: React.FC = () => {
  const { data, loading, heat, heatSystem, setHeatSystem, openChar } = useAnalyticsScope();
  return (
    <GridCard title="Тепловая карта: характеристики качества ИС" accent="slate" dotColor={accentColorOf('slate')}>
      {loading ? <Skeleton active paragraph={{ rows: 8 }} />
        : !data || !data.heatmapData.length
          ? <Text type="secondary">Нет данных для тепловой карты.</Text>
          : (
            <>
              <LevelHeatmap
                xLabels={data.xAxisLabels}
                yLabels={heat.yLabels}
                matrix={heat.matrix}
                charScores={data.characteristics?.map((c) => c.score)}
                onCharClick={data.characteristics
                  ? (_c, i) => openChar(data.characteristics![i]!)
                  : undefined}
                cellScores={heat.cellScores}
                onCellClick={heat.details.length
                  ? (y, x) => {
                    const sd = heat.details[y]?.chars[x];
                    if (sd) openChar({ ...sd, system: heat.yLabels[y] });
                  }
                  : undefined}
                cornerContent={(
                  <Select
                    size="small"
                    variant="borderless"
                    value={heatSystem}
                    onChange={setHeatSystem}
                    allowClear
                    showSearch
                    optionFilterProp="label"
                    placeholder={<span style={{ fontWeight: 500 }}><DatabaseOutlined /> Все системы</span>}
                    style={{ width: '100%', minWidth: 160 }}
                    options={data.yAxisLabels.map((s) => ({ value: s, label: s }))}
                  />
                )}
              />
              <div style={{ display: 'flex', gap: SPACE.base, marginTop: SPACE.cozy, flexWrap: 'wrap' }}>
                {LEVEL_ORDER.map((lvl) => (
                  <span key={lvl} style={{ display: 'flex', alignItems: 'center', gap: SPACE.tight, ...TYPE.micro, fontWeight: 400, color: BRAND.inkSoft }}>
                    <span style={{ width: 11, height: 11, borderRadius: 3, background: LEVEL_COLORS[lvl], display: 'inline-block' }} />
                    {lvl}
                  </span>
                ))}
              </div>
            </>
          )}
    </GridCard>
  );
};
