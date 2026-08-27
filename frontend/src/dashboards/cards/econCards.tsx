/**
 * econCards.tsx — карточки «Дашборда стоимости» риск-экономического контура.
 *
 * В каталог вынесены только аналитические виджеты вкладки «Дашборд стоимости» и рейтинг
 * руководителей. Рабочие вкладки контура (рисковые события, справочники, замыкание) остались
 * на своей странице: это формы ввода и реестры, а не карточки дашборда — раскладывать их по
 * сетке нечего.
 */
import React from 'react';
import { Alert, Space, Statistic, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import KpiCard from '../../components/KpiCard';
import { OwnerLink } from '../../components/OwnerLink';
import { accentColorOf, GOLD, PREMIUM, SPACE, TYPE } from '../../theme/premium';
import { numericColumn, numericText, sorterFor } from '../../theme/table';
import { BRAND, RAG } from '../../theme/ragPalette';
import {
  useEconScope, fmtMoney, fmtNum, fmtMln,
  type TopRisk, type RiskMeasureChainRow, type RiskMeasureChainMeasure, type ManagerMetricRow,
} from '../scopes/EconScope';
import GridCard from '../GridCard';

const { Text } = Typography;

const KpiRow: React.FC<{ children: React.ReactNode; min?: number }> = ({ children, min = 190 }) => (
  <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`, gap: SPACE.base }}>
    {children}
  </div>
);

// ─────────────────── KPI контура ───────────────────

export const EconKpiCard: React.FC = () => {
  const { d, loading, error } = useEconScope();
  return (
    <GridCard title="Ключевые показатели контура" accent="gold" dotColor={GOLD.base} hint="одна цифра, которую CEO уносит с совещания">
      {error && <Alert type="error" showIcon message="Ошибка загрузки дашборда" description={error} style={{ marginBottom: SPACE.cozy }} />}
      <KpiRow min={200}>
        <KpiCard loading={loading} title="Портфельный ALE, ₽/год" value={d ? fmtMoney(d.portfolioAle) : '—'}
          hint={d ? `${d.risksCount} рисковых событий` : undefined} />
        <KpiCard loading={loading} title="Замкнутость контура" value={d ? `${d.closureRate}%` : '—'}
          hint={d ? `${d.verified} из ${d.nonconformitiesTotal} верифицировано` : undefined} />
        <KpiCard loading={loading} title="Накопленная деградация, ₽" value={d ? fmtMoney(d.degradationTotal) : '—'}
          hint="сверх учтённых простоев" />
        <KpiCard loading={loading} title="Блокирующие дефекты" value={d ? d.blockingCount : '—'}
          color={d && d.blockingCount > 0 ? accentColorOf('terracotta') : undefined} hint="критические, не закрыты" />
      </KpiRow>
    </GridCard>
  );
};

// ─────────────────── Решения по несоответствиям ───────────────────

export const EconNonconformityCard: React.FC = () => {
  const { d } = useEconScope();
  return (
    <GridCard title="Решения по несоответствиям" accent="sage">
      <Space size="large" wrap style={{ width: '100%', justifyContent: 'space-around' }}>
        <Statistic title="Устранить" value={d?.verdict.eliminate ?? 0} valueStyle={{ ...TYPE.metricSm, color: BRAND.ink }} />
        <Statistic title="Компенсировать" value={d?.verdict.compensate ?? 0} valueStyle={{ ...TYPE.metricSm, color: BRAND.ink }} />
        <Statistic title="Принять" value={d?.verdict.accept ?? 0} valueStyle={{ ...TYPE.metricSm, color: BRAND.ink }} />
      </Space>
    </GridCard>
  );
};

// ─────────────────── ALE по системам ───────────────────

export const EconAleBySystemCard: React.FC = () => {
  const { d } = useEconScope();
  return (
    <GridCard title="ALE по системам" accent="slate">
      {(d?.bySystem ?? []).slice(0, 5).map((s) => (
        <div key={s.system} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: SPACE.snug }}>
          <Text>{s.system}</Text><Text strong style={numericText}>{fmtMoney(s.ale)}</Text>
        </div>
      ))}
      {(!d || d.bySystem.length === 0) && <Text type="secondary">Нет данных</Text>}
    </GridCard>
  );
};

// ─────────────────── Тепловая карта риска ───────────────────

export const EconHeatmapCard: React.FC = () => {
  const { d } = useEconScope();
  const heat = d?.heatmap ?? [];
  const systems = Array.from(new Set(heat.map((h) => h.system)));
  const subchars = Array.from(new Set(heat.map((h) => h.subcharacteristic)));
  const maxAle = Math.max(1, ...heat.map((h) => h.ale));
  const cellAle = (s: string, sub: string) => heat.find((h) => h.system === s && h.subcharacteristic === sub)?.ale ?? 0;

  return (
    <GridCard title="Тепловая карта риска: ИС × подхарактеристика (ALE)" accent="gold" dotColor={GOLD.base}>
      {systems.length === 0 ? (
        <Text type="secondary">Нет привязок рисков к подхарактеристикам — добавьте связи на вкладке «Рисковые события».</Text>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: `minmax(140px, 1.4fr) repeat(${subchars.length}, minmax(96px, 1fr))`, gap: 4 }}>
            <div />
            {subchars.map((sc) => (
              <div key={sc} style={{ ...TYPE.micro, color: BRAND.inkSoft, textAlign: 'center', padding: SPACE.tight }}>{sc}</div>
            ))}
            {systems.map((s) => (
              <React.Fragment key={s}>
                <div style={{ ...TYPE.captionStrong, color: BRAND.ink, display: 'flex', alignItems: 'center' }}>{s}</div>
                {subchars.map((sc) => {
                  const v = cellAle(s, sc);
                  const a = v / maxAle;
                  return (
                    <div key={sc} title={v > 0 ? fmtMoney(v) : undefined} style={{
                      background: v > 0 ? `rgba(185,154,85,${(0.15 + a * 0.75).toFixed(2)})` : PREMIUM.surfaceSoft,
                      borderRadius: PREMIUM.radiusSm, padding: SPACE.snug, textAlign: 'center',
                      ...TYPE.caption, ...numericText, color: BRAND.ink,
                    }}>
                      {v > 0 ? fmtMln(v) : '·'}
                    </div>
                  );
                })}
              </React.Fragment>
            ))}
          </div>
        </div>
      )}
    </GridCard>
  );
};

// ─────────────────── Топ рисков по стоимости ───────────────────

export const EconTopRisksCard: React.FC = () => {
  const { d, loading } = useEconScope();
  const cols: ColumnsType<TopRisk> = [
    { title: 'Код', dataIndex: 'code', width: 130, sorter: sorterFor((r: TopRisk) => r.code) },
    {
      title: 'Риск', dataIndex: 'title', sorter: sorterFor((r: TopRisk) => r.title),
      render: (t: string, r: TopRisk) => (
        <Space size={4}>{r.regulatory && <Tag color="volcano">рег.</Tag>}<Text strong>{t}</Text></Space>
      ),
    },
    { title: 'ИС', dataIndex: 'system', width: 140, sorter: sorterFor((r: TopRisk) => r.system), render: (s?: string) => s || '—' },
    { title: 'Владелец', dataIndex: 'owner', width: 160, sorter: sorterFor((r: TopRisk) => r.owner), render: (o?: string) => <OwnerLink owner={o} fallback="—" /> },
    numericColumn({ title: 'ALE, ₽/год', dataIndex: 'aleAvg', width: 150, sorter: sorterFor((r: TopRisk) => r.aleAvg), render: (v: number) => fmtMoney(v) }),
  ];
  return (
    <GridCard title="Топ рисков по стоимости" accent="terracotta" flush>
      <Table<TopRisk>
        columns={cols} dataSource={d?.topRisks ?? []} rowKey="code" loading={loading} size="small"
        pagination={false} scroll={{ x: 780 }}
        locale={{ emptyText: 'Нет рисковых событий с посчитанным ALE.' }}
      />
    </GridCard>
  );
};

// ─────────────────── Портфельный итог по мерам ───────────────────

export const EconPortfolioSummaryCard: React.FC = () => {
  const { summary, chainLoading } = useEconScope();
  return (
    <GridCard title="Портфельный итог по мерам" accent="slate">
      <KpiRow>
        <KpiCard loading={chainLoading} title="Всего под риском, ₽/год" value={summary ? fmtMoney(summary.totalAtRisk) : '—'}
          hint={summary ? `${summary.risksCount} рисковых событий` : undefined} />
        <KpiCard loading={chainLoading} title="Покрыто выполненными мерами, ₽/год" value={summary ? fmtMoney(summary.coveredByDoneMeasures) : '—'}
          color={summary && summary.coveredByDoneMeasures > 0 ? accentColorOf('sage') : undefined} />
        <KpiCard loading={chainLoading} title="Остаточный риск, ₽/год" value={summary ? fmtMoney(summary.residualRisk) : '—'}
          color={summary && summary.residualRisk > 0 ? accentColorOf('terracotta') : undefined} />
        <KpiCard loading={chainLoading} title="Требуемые вложения, ₽" value={summary ? fmtMoney(summary.requiredInvestment) : '—'}
          hint={summary ? `${summary.measuresCount} мер` : undefined} />
        <KpiCard loading={chainLoading} title="Ожидаемый эффект, ₽/год" value={summary ? fmtMoney(summary.expectedEffect) : '—'}
          hint="одобрены, ещё не выполнены" />
      </KpiRow>
    </GridCard>
  );
};

// ─────────────────── Риск → мера → эффект ───────────────────

export const EconRiskMeasureEffectCard: React.FC = () => {
  const { chain, chainLoading } = useEconScope();
  return (
    <GridCard title="Риск → мера → эффект" accent="ink" hint="разворот строки — меры по риску" flush>
      <Table<RiskMeasureChainRow>
        rowKey="riskId" loading={chainLoading} size="small" pagination={{ pageSize: 10, hideOnSinglePage: true }}
        dataSource={chain}
        locale={{ emptyText: 'Нет активных рисковых событий.' }}
        expandable={{
          rowExpandable: (r) => r.measures.length > 0,
          expandedRowRender: (r) => (
            <Table<RiskMeasureChainMeasure>
              rowKey="proposalId" size="small" pagination={false} dataSource={r.measures}
              scroll={{ x: 1000 }}
              columns={[
                { title: 'Мера', dataIndex: 'title' },
                { title: 'Статус', dataIndex: 'status', width: 130,
                  render: (s: string, m) => (
                    <Space size={4}>
                      <Tag>{s}</Tag>
                      {m.execution && <Tag color={m.execution === 'DONE' ? 'green' : 'red'}>{m.execution === 'DONE' ? 'выполнено' : 'не выполнено'}</Tag>}
                    </Space>
                  ) },
                numericColumn({ title: 'Доля снятия', dataIndex: 'aleReductionShare', width: 100,
                  render: (v: number | null) => v == null ? '—' : `${Math.round(v * 100)}%` }),
                numericColumn({ title: 'ΔALE (деньги)', dataIndex: 'deltaAleCash', width: 130, render: (v: number | null) => fmtMoney(v) }),
                numericColumn({ title: 'CAPEX', dataIndex: 'capex', width: 120, render: (v: number | null) => fmtMoney(v) }),
                numericColumn({ title: 'OPEX/год', dataIndex: 'opexPerYear', width: 120, render: (v: number | null) => fmtMoney(v) }),
                numericColumn({ title: 'ROSI', dataIndex: 'rosi', width: 90, render: (v: number | null) => v == null ? '—' : fmtNum(v) }),
                numericColumn({ title: 'Окупаемость, мес.', dataIndex: 'paybackMonths', width: 130,
                  render: (v: number | null) => v == null ? '—' : fmtNum(v, 1) }),
                { title: 'Вердикт', dataIndex: 'verdict', width: 110, render: (v: string | null) => v || '—' },
              ]}
            />
          ),
        }}
        columns={[
          { title: 'Риск', dataIndex: 'riskTitle', sorter: sorterFor((r: RiskMeasureChainRow) => r.riskTitle),
            render: (t: string, r) => <Space size={4}><Text type="secondary" style={{ fontSize: 12 }}>{r.riskCode}</Text><Text strong>{t}</Text></Space> },
          { title: 'ИС', dataIndex: 'systemName', width: 160, render: (s: string | null) => s || '—' },
          numericColumn({ title: 'ALE, ₽/год', dataIndex: 'aleAvg', width: 150,
            sorter: sorterFor((r: RiskMeasureChainRow) => r.aleAvg), render: (v: number | null) => fmtMoney(v) }),
          numericColumn({ title: 'Мер привязано', key: 'measuresCount', width: 130,
            sorter: sorterFor((r: RiskMeasureChainRow) => r.measures.length),
            render: (_: unknown, r) => r.measures.length || <Text type="secondary">0</Text> }),
        ]}
      />
    </GridCard>
  );
};

// ─────────────────── Когда придут деньги ───────────────────

export const EconQuarterlyEffectCard: React.FC = () => {
  const { curve, curveLoading } = useEconScope();
  return (
    <GridCard
      title="Когда придут деньги: портфельный эффект по кварталам"
      accent="sage"
      hint="по одобренным мерам, с учётом лага внедрения"
    >
      {curveLoading ? (
        <Text type="secondary">Загрузка…</Text>
      ) : !curve || curve.points.length === 0 ? (
        <Text type="secondary">Нет одобренных мер с посчитанной экономикой — кривую строить не из чего.</Text>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
            {curve.points.map((pt) => (
              <div key={pt.quarterLabel} style={{
                minWidth: 100, padding: '6px 8px', borderRadius: 6,
                background: BRAND.surface, border: `1px solid ${PREMIUM.border}`,
              }}>
                <Text style={{ fontSize: TYPE.micro.fontSize, display: 'block' }} type="secondary">{pt.quarterLabel}</Text>
                <Text style={{ fontSize: 12, display: 'block', color: pt.netCash > 0 ? RAG.good.strong : pt.netCash < 0 ? RAG.bad.strong : undefined }}>
                  {pt.netCash > 0 ? '+' : ''}{fmtMoney(pt.netCash)}
                </Text>
                <Text style={{ fontSize: 12, display: 'block', color: pt.cumulative >= 0 ? RAG.good.strong : RAG.bad.strong }}>
                  Σ {fmtMoney(pt.cumulative)}
                </Text>
              </div>
            ))}
          </div>
          <Text type="secondary" style={{ fontSize: TYPE.micro.fontSize, display: 'block', marginTop: 8 }}>
            Учтено мер: {curve.measuresIncluded}
            {curve.measuresExcludedNoStartDate > 0 && <> · без решения (не входят в расчёт): {curve.measuresExcludedNoStartDate}</>}
          </Text>
        </>
      )}
    </GridCard>
  );
};

export { EconManagersCard } from './econManagersCard';
