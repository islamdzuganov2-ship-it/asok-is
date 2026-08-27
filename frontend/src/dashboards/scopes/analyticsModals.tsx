/**
 * analyticsModals.tsx — модалки-раскрытия аналитического дашборда.
 *
 * Три раскрытия: что входит в KPI-плитку, подхарактеристики выбранной характеристики и
 * просевшие метрики конкретной ИС (ТЗ v20 п.7.1). Вынесены из AnalyticsScope, чтобы скоуп
 * остался про данные и состояние, а таблицы жили отдельно.
 */
import React from 'react';
import { Modal, Table, Tag, Typography } from 'antd';
import { LEVEL_TAG_COLORS } from '../../components/LevelHeatmap';
import { critTagStyle, levelLabel, solidTagStyle, RAG } from '../../theme/ragPalette';
import { numericColumn, sorterFor } from '../../theme/table';
import type {
  CharDetail, DashboardData, SubDetail, SystemContribution, SystemScoreBreakdown,
} from './AnalyticsScope';

const { Text } = Typography;

/** Ранг критичности для сортировки — не алфавитный. */
const CRIT_RANK: Record<string, number> = { 'MISSION CRITICAL': 0, 'BUSINESS CRITICAL': 1, 'BUSINESS OPERATIONAL': 2 };
const critTag = (v: string) => <Tag style={critTagStyle(v)}>{v}</Tag>;

export type DetailKey = 'global' | 'metrics' | 'systems' | 'low' | 'measures';

export const DETAIL_TITLE: Record<DetailKey, string> = {
  global: 'Глобальный балл — из чего складывается',
  metrics: 'Все метрики по уровням качества',
  systems: 'ИС в мониторинге',
  low: 'Низкие метрики по системам',
  measures: 'Метрики, имеющие связанные меры',
};

interface DetailProps {
  detail: DetailKey | null;
  data: DashboardData | null;
  healthPct: number;
  lowTotal: number;
  levelDist: { level: string; count: number; pct: number }[];
  measureRows: { key: string; system: string; characteristic: string; metric: string; measures: number }[];
}
export const AnalyticsDetail: React.FC<DetailProps> = ({ detail, data, healthPct, lowTotal, levelDist, measureRows }) => {
    if (!data || !detail) return null;
    if (detail === 'global' || detail === 'metrics') {
      return (
        <>
          {detail === 'global' && (
            data.scoreBreakdown ? (
              <>
                <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
                  Глобальный балл {healthPct}% — взвешенная свёртка баллов {data.yAxisLabels.length} ИС,
                  вес каждой — класс критичности системы (не голое среднее). Ниже — вклад каждой ИС,
                  от наибольшего к наименьшему.
                </Text>
                <Table
                  dataSource={data.scoreBreakdown.systemContributions}
                  rowKey="system"
                  size="small"
                  pagination={false}
                  style={{ marginBottom: 16 }}
                  columns={[
                    { title: 'ИС', dataIndex: 'system', ellipsis: true, sorter: sorterFor((r: SystemContribution) => r.system) },
                    { title: 'Критичность', dataIndex: 'criticality',
                      sorter: sorterFor((r: SystemContribution) => CRIT_RANK[r.criticality ?? ''] ?? -1),
                      render: (v: string | null) => v ? critTag(v) : <Text type="secondary">—</Text> },
                    numericColumn({ title: 'Балл', dataIndex: 'score', width: 80,
                      sorter: sorterFor((r: SystemContribution) => r.score),
                      render: (v: number) => <Text>{v}%</Text> }),
                    numericColumn({ title: 'Вес', dataIndex: 'criticalityWeight', width: 70,
                      sorter: sorterFor((r: SystemContribution) => r.criticalityWeight) }),
                    numericColumn({ title: 'Вклад в баллах', dataIndex: 'pointsContribution', width: 130,
                      sorter: sorterFor((r: SystemContribution) => r.pointsContribution),
                      defaultSortOrder: 'descend',
                      render: (v: number) => <Text strong>{v.toFixed(1)}</Text> }),
                  ]}
                />
              </>
            ) : (
              <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
                Глобальный балл {healthPct}% — среднее по {data.totalMetrics} метрикам {data.yAxisLabels.length} ИС.
                Ниже — распределение метрик по уровням качества.
              </Text>
            )
          )}
          <Table
            dataSource={levelDist} rowKey="level" size="small" pagination={false}
            locale={{ emptyText: 'Нет рассчитанных метрик за период' }}
            columns={[
              { title: 'Уровень', dataIndex: 'level', sorter: sorterFor((r: any) => r.level),
                render: (v: string) => <Tag style={solidTagStyle(LEVEL_TAG_COLORS[v])}>{v}</Tag> },
              numericColumn({ title: 'Метрик', dataIndex: 'count', width: 90, sorter: sorterFor((r: any) => r.count) }),
              numericColumn({ title: 'Доля', dataIndex: 'pct', width: 90, sorter: sorterFor((r: any) => r.pct), render: (v: number) => `${v}%` }),
            ]}
          />
        </>
      );
    }
    if (detail === 'measures') {
      return (
        <>
          <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
            Метрик со связанной мерой: {measureRows.length}. Связка определяется по ключу
            «система · характеристика · метрика» (метрика ↔ мера качества), без LLM.
          </Text>
          <Table
            dataSource={measureRows} rowKey="key" size="small"
            pagination={{ pageSize: 10, hideOnSinglePage: true }}
            locale={{ emptyText: 'Нет метрик со связанными мерами' }}
            columns={[
              { title: 'ИС', dataIndex: 'system', ellipsis: true, sorter: sorterFor((r: any) => r.system) },
              { title: 'Характеристика', dataIndex: 'characteristic', ellipsis: true, sorter: sorterFor((r: any) => r.characteristic) },
              { title: 'Метрика', dataIndex: 'metric', ellipsis: true, sorter: sorterFor((r: any) => r.metric) },
              numericColumn({
                title: 'Мер', dataIndex: 'measures', width: 70,
                sorter: sorterFor((r: any) => r.measures),
                render: (v: number) => <Tag style={solidTagStyle(RAG.good.strong)}>{v}</Tag>,
              }),
            ]}
          />
        </>
      );
    }
    const rows = detail === 'low'
      ? [...data.problematicSystems].sort((a, b) => b.lowMetricsCount - a.lowMetricsCount)
      : data.problematicSystems;
    return (
      <>
        <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
          {detail === 'systems'
            ? `Всего ИС в мониторинге: ${data.yAxisLabels.length}. Ниже — системы с наибольшим числом низких метрик.`
            : `Всего низких метрик: ${lowTotal} по ${rows.length} системам.`}
        </Text>
        <Table
          dataSource={rows} rowKey="id" size="small" pagination={false}
          columns={[
            { title: 'ИС', dataIndex: 'name', ellipsis: true, sorter: sorterFor((r: any) => r.name) },
            { title: 'Критичность', dataIndex: 'criticality', sorter: sorterFor((r: any) => CRIT_RANK[r.criticality] ?? -1), render: critTag },
            numericColumn({ title: 'Низких метрик', dataIndex: 'lowMetricsCount', width: 130,
              sorter: sorterFor((r: any) => r.lowMetricsCount),
              render: (v: number) => <Text type="danger" strong>{v}</Text> }),
          ]}
        />
      </>
    );
};


export const AnalyticsCharModal: React.FC<{ charDetail: (CharDetail & { system?: string }) | null; onClose: () => void }> = ({ charDetail, onClose }) => (
  <>
      <Modal
        open={!!charDetail}
        onCancel={onClose}
        footer={null}
        width={560}
        title={charDetail
          ? `${charDetail.system ? charDetail.system + ' · ' : ''}${charDetail.title} — ${charDetail.score < 0 ? 'невозможно измерить' : charDetail.score + '%'}`
          : ''}
      >
        {charDetail && (
          <Table<SubDetail>
            dataSource={charDetail.subs}
            rowKey="name"
            size="small"
            pagination={false}
            columns={[
              { title: 'Подхарактеристика', dataIndex: 'name', sorter: sorterFor((r: SubDetail) => r.name) },
              numericColumn({
                title: 'Качество', dataIndex: 'score', width: 200,
                sorter: sorterFor((r: SubDetail) => r.score),
                render: (v: number) => {
                  const lvl = levelLabel(v < 0 ? -1 : v);
                  return <Tag style={solidTagStyle(LEVEL_TAG_COLORS[lvl])}>{v < 0 ? 'н/д' : `${v}%`} · {lvl}</Tag>;
                },
              }),
            ]}
          />
        )}
      </Modal>


  </>
);

interface SysLow { system: string; rows: { characteristic: string; subcharacteristic: string; score: number }[]; breakdown?: SystemScoreBreakdown }

export const AnalyticsSystemLowModal: React.FC<{ detail: SysLow | null; onClose: () => void }> = ({ detail: sysLowDetail, onClose }) => (
  <>
      <Modal
        open={!!sysLowDetail}
        onCancel={onClose}
        footer={null}
        width={600}
        title={sysLowDetail ? `${sysLowDetail.system} — низкие метрики (${sysLowDetail.rows.length})` : ''}
      >
        {sysLowDetail && (
          <>
            {sysLowDetail.breakdown && (
              <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
                Покрытие измеримостью: {Math.round(sysLowDetail.breakdown.coverage * 100)}%
                {' '}({sysLowDetail.breakdown.weightApplied} из {sysLowDetail.breakdown.weightTotal} баллов веса
                модели измерено — остальное не влияет на балл системы, вместо штрафа за нехватку данных).
              </Text>
            )}
            {sysLowDetail.rows.length === 0 ? (
              <Text type="secondary">Нет метрик уровня «Низкий уровень» по этой ИС.</Text>
            ) : (
              <Table
                dataSource={sysLowDetail.rows} rowKey={(r) => `${r.characteristic}|${r.subcharacteristic}`}
                size="small" pagination={false}
                columns={[
                  { title: 'Характеристика', dataIndex: 'characteristic', ellipsis: true, sorter: sorterFor((r: any) => r.characteristic) },
                  { title: 'Подхарактеристика', dataIndex: 'subcharacteristic', ellipsis: true, sorter: sorterFor((r: any) => r.subcharacteristic) },
                  numericColumn({ title: 'Балл', dataIndex: 'score', width: 100,
                    sorter: sorterFor((r: any) => r.score),
                    render: (v: number) => <Tag style={solidTagStyle(RAG.bad.strong)}>{v}%</Tag> }),
                ]}
              />
            )}
          </>
        )}
      </Modal>
  </>
);
